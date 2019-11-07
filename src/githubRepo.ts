import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';
import { IssueEvent } from './models/issueEvent';

type Issue = Octokit.IssuesListForRepoResponseItem;

// Cache GitHub repo related information and perform actions 
export class GithubRepo {
    private _client: github.GitHub;
    private _collaborators: string[] = [];
    private _eventsToCheck: string[];

    constructor(client: github.GitHub, eventsToCheck: string[]) {
        this._client = client;
        this._eventsToCheck = eventsToCheck;
    }

    public async checkIssueLastUpdatedByCollaborator(issue: Issue, checkEvents: boolean): Promise<{ result: boolean; operations: number }> {
        let operations = 0;
        operations += await this.ensureCollaboratorList();
        const allComments = await this.getAllCommentsForIssue(issue);
        operations += allComments.operations;
        let allIssueEvents = allComments.result;
        if (checkEvents) {
            const allEvents = await this.getAllEventsForIssue(issue);
            operations += allEvents.operations;
            allIssueEvents.concat(allEvents.result);
        }

        const latestEvent = allIssueEvents.reduce((prev, current) =>
            prev.eventTime > current.eventTime ? prev : current
        );

        if (this._collaborators.indexOf(latestEvent.actor) !== -1) {
            return {
                result: true,
                operations: operations
            }
        } else {
            return {
                result: false,
                operations: operations
            }
        }
    }

    private async getAllCommentsForIssue(issue: Issue): Promise<{ result: IssueEvent[], operations: number }> {
        const allComments = await this.getAllResult(async (page) => {
            return await this._client.issues.listComments({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: issue.number,
                per_page: 100,
                page: page
            })
        });

        let commentEvents: IssueEvent[] = [];
        for (var comment of allComments.result) {
            commentEvents.push(new IssueEvent(comment.user.login, "commented", new Date(comment.created_at)));
        }
        return {
            result: commentEvents,
            operations: allComments.operations
        };
    }

    private async getAllEventsForIssue(issue: Issue): Promise<{ result: IssueEvent[], operations: number }> {
        const allEvents = await this.getAllResult(async (page) => {
            return await this._client.issues.listEvents({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: issue.number,
                per_page: 100,
                page: page
            })
        });

        let issueEvents: IssueEvent[] = [];
        for (var event of allEvents.result) {
            if (this._eventsToCheck.indexOf(event.event) !== -1) {
                switch (event.event) {
                    case "assigned":
                    case "unassigned":
                        // TODO: Get actual assigner as actor when github client returns required info in the future.
                        let actor = event.actor.login;
                        issueEvents.push(new IssueEvent(actor, event.event, new Date(event.created_at)));
                        break;
                    default:
                        issueEvents.push(new IssueEvent(event.actor.login, event.event, new Date(event.created_at)));
                        break;
                }
            }
        }
        return {
            result: issueEvents,
            operations: allEvents.operations
        };
    }

    private async ensureCollaboratorList(): Promise<number> {
        if (this._collaborators.length > 0) {
            return 0; // Already pulled collaborators list
        }

        var result = await this.getAllResult(async (page) => {
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

    private async getAllResult<T>(request: (page: number) => Promise<Octokit.Response<T[]>>): Promise<{ result: T[], operations: number }> {
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