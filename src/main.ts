import * as core from '@actions/core';
import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';
import {Constants} from './constants';

type Issue = Octokit.IssuesListForRepoResponseItem;
type IssueLabel = Octokit.IssuesListForRepoResponseItemLabelsItem;

type Args = {
  repoToken: string;
  staleIssueMessage: string;
  stalePrMessage: string;
  daysBeforeStale: number;
  daysBeforeClose: number;
  staleIssueLabel: string;
  exemptIssueLabel: string;
  stalePrLabel: string;
  exemptPrLabel: string;
  operationsPerRun: number;
  lastUpdatedUserType: string;
  onlyLabels: string;
};

async function run() {
  try {
    const args = getAndValidateArgs();

    const client = new github.GitHub(args.repoToken);
    await processIssues(client, args, args.operationsPerRun);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

async function processIssues(
  client: github.GitHub,
  args: Args,
  operationsLeft: number,
  page: number = 1
): Promise<number> {
  const issues = await client.issues.listForRepo({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    state: 'open',
    per_page: 100,
    page: page,
    labels: args.onlyLabels
  });

  operationsLeft -= 1;

  if (issues.data.length === 0 || operationsLeft === 0) {
    return operationsLeft;
  }

  for (var issue of issues.data.values()) {
    core.debug(`found issue: ${issue.title} last updated ${issue.updated_at}`);
    let isPr = !!issue.pull_request;

    let staleMessage = isPr ? args.stalePrMessage : args.staleIssueMessage;
    if (!staleMessage) {
      core.debug(`skipping ${isPr ? 'pr' : 'issue'} due to empty message`);
      continue;
    }

    let staleLabel = isPr ? args.stalePrLabel : args.staleIssueLabel;
    let exemptLabel = isPr ? args.exemptPrLabel : args.exemptIssueLabel;

    if (exemptLabel && isLabeled(issue, exemptLabel)) {
      continue;
    } else if (isLabeled(issue, staleLabel)) {
      if (wasLastUpdatedBefore(issue, args.daysBeforeClose)) {
        var lastCommentFilterResult = await wasLastUpdatedByGivenUserType(
          client,
          issue,
          args.lastUpdatedUserType
        );
        operationsLeft -= lastCommentFilterResult.operations;
        if (lastCommentFilterResult.result) {
          operationsLeft -= await closeIssue(client, issue);
        } else {
          core.debug(`Not match last-commented-user-filter. Skipping close.`);
        }
      } else {
        continue;
      }
    } else if (wasLastUpdatedBefore(issue, args.daysBeforeStale)) {
      var lastCommentFilterResult = await wasLastUpdatedByGivenUserType(
        client,
        issue,
        args.lastUpdatedUserType
      );
      operationsLeft -= lastCommentFilterResult.operations;
      if (lastCommentFilterResult.result) {
        operationsLeft -= await markStale(
          client,
          issue,
          staleMessage,
          staleLabel
        );
      } else {
        core.debug(
          `Not match last-commented-user-filter. Skipping mark stale.`
        );
      }
    }

    if (operationsLeft <= 0) {
      core.warning(
        `performed ${args.operationsPerRun} operations, exiting to avoid rate limit`
      );
      return 0;
    }
  }
  return await processIssues(client, args, operationsLeft, page + 1);
}

function isLabeled(issue: Issue, label: string): boolean {
  const labelComparer: (l: IssueLabel) => boolean = l =>
    label.localeCompare(l.name, undefined, {sensitivity: 'accent'}) === 0;
  return issue.labels.filter(labelComparer).length > 0;
}

function wasLastUpdatedBefore(issue: Issue, num_days: number): boolean {
  const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
  const millisSinceLastUpdated =
    new Date().getTime() - new Date(issue.updated_at).getTime();
  return millisSinceLastUpdated >= daysInMillis;
}

async function wasLastUpdatedByGivenUserType(
  client: github.GitHub,
  issue: Issue,
  lastUpdatedUserType: string
): Promise<{result: boolean; operations: number}> {
  var operationNumber = 0;
  if (
    !lastUpdatedUserType ||
    Constants.AvailableLastCommentedUserTypes.indexOf(lastUpdatedUserType) ===
      -1
  ) {
    core.debug(
      'Last comment user type is not set or not valid. Skip last updated user type filter.'
    );
    return {result: true, operations: operationNumber};
  }

  const events = await client.issues.listEvents({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number
  });
  operationNumber++;
  let latestEventActor = '';
  if (events.data.length == 0) {
    latestEventActor = issue.user.login;
  } else {
    const latestEvent = events.data.reduce((prev, current) =>
      prev.created_at > current.created_at ? prev : current
    );
    latestEventActor = latestEvent.actor.login;
  }

  try {
    operationNumber++;
    const isCollaborator = await client.repos.checkCollaborator({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      username: latestEventActor
    });
    if (isCollaborator.status === 204) {
      return {
        result:
          lastUpdatedUserType === Constants.UserType.Collaborator
            ? true
            : false,
        operations: operationNumber
      };
    } else {
      core.debug(
        'Unexpected status code from check collaborator api. Skip last updated user type filter.'
      );
      return {
        result: true,
        operations: operationNumber
      };
    }
  } catch (error) {
    if (error.status === 404) {
      return {
        result:
          lastUpdatedUserType !== Constants.UserType.Collaborator
            ? true
            : false,
        operations: operationNumber
      };
    } else {
      throw error;
    }
  }
}

async function markStale(
  client: github.GitHub,
  issue: Issue,
  staleMessage: string,
  staleLabel: string
): Promise<number> {
  core.debug(`marking issue${issue.title} as stale`);

  await client.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number,
    body: staleMessage
  });

  await client.issues.addLabels({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number,
    labels: [staleLabel]
  });

  return 2; // operations performed
}

async function closeIssue(
  client: github.GitHub,
  issue: Issue
): Promise<number> {
  core.debug(`closing issue ${issue.title} for being stale`);

  await client.issues.update({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue.number,
    state: 'closed'
  });

  return 1; // operations performed
}

function getAndValidateArgs(): Args {
  const args = {
    repoToken: core.getInput('repo-token', {required: true}),
    staleIssueMessage: core.getInput('stale-issue-message'),
    stalePrMessage: core.getInput('stale-pr-message'),
    daysBeforeStale: parseInt(
      core.getInput('days-before-stale', {required: true})
    ),
    daysBeforeClose: parseInt(
      core.getInput('days-before-close', {required: true})
    ),
    staleIssueLabel: core.getInput('stale-issue-label', {required: true}),
    exemptIssueLabel: core.getInput('exempt-issue-label'),
    stalePrLabel: core.getInput('stale-pr-label', {required: true}),
    exemptPrLabel: core.getInput('exempt-pr-label'),
    operationsPerRun: parseInt(
      core.getInput('operations-per-run', {required: true})
    ),
    lastUpdatedUserType: core.getInput('last-updated-user-type'),
    onlyLabels: core.getInput('only-labels')
  };

  for (var numberInput of [
    'days-before-stale',
    'days-before-close',
    'operations-per-run'
  ]) {
    if (isNaN(parseInt(core.getInput(numberInput)))) {
      throw Error(`input ${numberInput} did not parse to a valid integer`);
    }
  }

  return args;
}

run();
