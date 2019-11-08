import * as core from '@actions/core';
import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';
import {Constants} from './constants';
import {GithubRepo} from './githubRepo';

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
  eventsForCollaborators: string[];
};

async function run() {
  try {
    const args = getAndValidateArgs();

    const client = new github.GitHub(args.repoToken);
    const githubRepo = new GithubRepo(client, args.eventsForCollaborators);
    await processIssues(githubRepo, args);
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

async function processIssues(
  githubRepo: GithubRepo,
  args: Args
): Promise<void> {
  let operationsLeft = args.operationsPerRun;
  const issues = await githubRepo.getAllIssuesForRepo(args.onlyLabels);

  operationsLeft -= issues.operations;

  if (issues.result.length === 0) {
    core.debug(`No open issues found with configured filter.`);
    return;
  }

  if (operationsLeft <= 0) {
    core.debug(
      `Reaches max operations limit after list all issues. Please increase the operations-per-run.`
    );
    return;
  }

  for (var issue of issues.result.values()) {
    core.debug(`Found issue: ${issue.title} last updated ${issue.updated_at}`);
    let isPr = !!issue.pull_request;

    let staleMessage = isPr ? args.stalePrMessage : args.staleIssueMessage;
    if (!staleMessage) {
      core.debug(`Skipping ${isPr ? 'pr' : 'issue'} due to empty message`);
      continue;
    }

    let staleLabel = isPr ? args.stalePrLabel : args.staleIssueLabel;
    let exemptLabel = isPr ? args.exemptPrLabel : args.exemptIssueLabel;

    if (exemptLabel && isLabeled(issue, exemptLabel)) {
      core.debug(
        `Found exempt label for issue ${issue.title}. Skip processing.`
      );
      continue;
    } else if (isLabeled(issue, staleLabel)) {
      if (wasLastUpdatedBefore(issue, args.daysBeforeClose)) {
        var lastCommentFilterResult = await wasLastUpdatedByGivenUserType(
          githubRepo,
          issue,
          args.lastUpdatedUserType
        );
        operationsLeft -= lastCommentFilterResult.operations;
        if (lastCommentFilterResult.result) {
          operationsLeft -= await githubRepo.closeIssue(issue);
        } else {
          core.debug(`Not match last-updated-user-type. Skip closing.`);
        }
      } else {
        continue;
      }
    } else if (wasLastUpdatedBefore(issue, args.daysBeforeStale)) {
      var lastCommentFilterResult = await wasLastUpdatedByGivenUserType(
        githubRepo,
        issue,
        args.lastUpdatedUserType
      );
      operationsLeft -= lastCommentFilterResult.operations;
      if (lastCommentFilterResult.result) {
        operationsLeft -= await githubRepo.addLabelToIssueWithComment(
          issue,
          staleMessage,
          staleLabel
        );
      } else {
        core.debug(`Not match last-updated-user-type. Skip marking stale.`);
      }
    }

    if (operationsLeft <= 0) {
      core.warning(
        `Performed ${args.operationsPerRun} operations, exiting to avoid rate limit`
      );
    }
  }
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
  githubRepo: GithubRepo,
  issue: Issue,
  lastUpdatedUserType: string
): Promise<{result: boolean; operations: number}> {
  if (
    !lastUpdatedUserType ||
    Constants.AvailableLastCommentedUserTypes.indexOf(lastUpdatedUserType) ===
      -1
  ) {
    core.debug(
      'Last comment user type is not set or not valid. Skip last updated user type filter.'
    );
    return {result: true, operations: 0};
  }

  const lastUpdatedByCollaborator = await githubRepo.checkIssueLastUpdatedByCollaborator(
    issue
  );

  return {
    result:
      lastUpdatedUserType === Constants.UserType.Collaborator
        ? lastUpdatedByCollaborator.result
        : !lastUpdatedByCollaborator.result,
    operations: lastUpdatedByCollaborator.operations
  };
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
    onlyLabels: core.getInput('only-labels'),
    eventsForCollaborators: core
      .getInput('include-events-from-collaborators')
      .split(',')
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
