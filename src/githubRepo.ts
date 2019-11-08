import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';
import {IssueEvent} from './models/issueEvent';

type Issue = Octokit.IssuesListForRepoResponseItem;

// Cache GitHub repo related information and perfor
export class GithubRepo {
  private _client: github.GitHub;
  private _collaborators: string[];
  private _eventsFromCollaborators: string[];
  private _ignoreEventsFromBot: boolean = true;

  constructor(client: github.GitHub, eventsToCheck: string[]) {
    this._client = client;
    this._eventsFromCollaborators = eventsToCheck;
    this._collaborators = [];
  }

  public async getAllIssuesForRepo(
    labels: string
  ): Promise<{result: Issue[]; operations: number}> {
    return this.getAllResult(async page => {
      return await this._client.issues.listForRepo({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        state: 'open',
        per_page: 100,
        page: page,
        labels: labels
      });
    });
  }

  public async addLabelToIssueWithComment(
    issue: Issue,
    message: string,
    label: string
  ): Promise<number> {
    await this._client.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issue.number,
      body: message
    });

    await this._client.issues.addLabels({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issue.number,
      labels: [label]
    });

    return 2; // operations performed
  }

  public async closeIssue(issue: Issue): Promise<number> {
    await this._client.issues.update({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issue.number,
      state: 'closed'
    });

    return 1; // operations performed
  }

  public async checkIssueLastUpdatedByCollaborator(
    issue: Issue
  ): Promise<{result: boolean; operations: number}> {
    let operations = 0;
    operations += await this.ensureCollaboratorList();
    const allComments = await this.getAllCommentsForIssue(issue);
    operations += allComments.operations;
    let issueTimeline = allComments.result;
    if (this._eventsFromCollaborators.length > 0) {
      const allEvents = await this.getAllEventsForIssue(issue);
      operations += allEvents.operations;
      issueTimeline.push(...allEvents.result);
    }

    let lastUpdatedUser: string;
    if (issueTimeline.length === 0) {
      lastUpdatedUser = issue.user.login;
    } else {
      const lastEvent = issueTimeline.reduce((prev, current) =>
        prev.eventTime > current.eventTime ? prev : current
      );
      lastUpdatedUser = lastEvent.actor;
    }

    if (this._collaborators.indexOf(lastUpdatedUser) !== -1) {
      return {
        result: true,
        operations: operations
      };
    } else {
      return {
        result: false,
        operations: operations
      };
    }
  }

  private async getAllCommentsForIssue(
    issue: Issue
  ): Promise<{result: IssueEvent[]; operations: number}> {
    const allComments = await this.getAllResult(async page => {
      return await this._client.issues.listComments({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        per_page: 100,
        page: page
      });
    });

    let commentEvents: IssueEvent[] = [];
    for (var comment of allComments.result) {
      if (!this._ignoreEventsFromBot || comment.user.type !== 'Bot') {
        commentEvents.push(
          new IssueEvent(
            comment.user.login,
            'commented',
            new Date(comment.created_at)
          )
        );
      }
    }
    return {
      result: commentEvents,
      operations: allComments.operations
    };
  }

  private async getAllEventsForIssue(
    issue: Issue
  ): Promise<{result: IssueEvent[]; operations: number}> {
    let totalOperations = await this.ensureCollaboratorList();
    const allEvents = await this.getAllResult(async page => {
      return await this._client.issues.listEvents({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue.number,
        per_page: 100,
        page: page
      });
    });
    totalOperations += allEvents.operations;

    let issueEvents: IssueEvent[] = [];
    for (var event of allEvents.result) {
      if (!this._ignoreEventsFromBot || event.actor.type !== 'Bot') {
        if (this._eventsFromCollaborators.indexOf(event.event) !== -1) {
          let issueEvent: IssueEvent;
          switch (event.event) {
            case 'assigned':
            case 'unassigned':
              // TODO: Get actual assigner as actor when github client returns required info in the future.
              let actor = event.actor.login;
              issueEvent = new IssueEvent(
                actor,
                event.event,
                new Date(event.created_at)
              );
              break;
            default:
              issueEvent = new IssueEvent(
                event.actor.login,
                event.event,
                new Date(event.created_at)
              );
              break;
          }
          if (this._collaborators.indexOf(issueEvent.actor) !== -1) {
            issueEvents.push(issueEvent);
          }
        }
      }
    }
    return {
      result: issueEvents,
      operations: totalOperations
    };
  }

  private async ensureCollaboratorList(): Promise<number> {
    if (this._collaborators.length > 0) {
      return 0; // Already pulled collaborators list
    }

    var result = await this.getAllResult(async page => {
      return await this._client.repos.listCollaborators({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        per_page: 100,
        page: page
      });
    });
    for (var collaborator of result.result) {
      this._collaborators.push(collaborator.login);
    }

    return result.operations;
  }

  private async getAllResult<T>(
    request: (page: number) => Promise<Octokit.Response<T[]>>
  ): Promise<{result: T[]; operations: number}> {
    let allResult: T[] = [];
    let page = 1;
    let operations = 0;
    let requestResult = await request(page);
    operations++;
    page++;
    while (requestResult.data.length !== 0) {
      for (var item of requestResult.data.values()) {
        allResult.push(item);
      }
      requestResult = await request(page);
      operations++;
      page++;
    }
    return {
      result: allResult,
      operations: operations
    };
  }
}
