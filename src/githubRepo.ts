import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';
import { IssueEvent } from './models/issueEvent';

import * as core from '@actions/core'; //remove

type Issue = Octokit.IssuesListForRepoResponseItem;

// Cache GitHub repo related information and perfor 
export class GithubRepo {
    private _client: github.GitHub;
    private _collaborators: string[];
    private _eventsToCheck: string[];
    private _ignoreEventsFromBot: boolean = true;

    constructor(client: github.GitHub, eventsToCheck: string[]) {
        this._client = client;
        this._eventsToCheck = eventsToCheck;
        this._collaborators = [];
        core.debug("events to check length: "+ this._eventsToCheck.length); //remove
        core.debug("events to check:" + this._eventsToCheck.toString); //remove
        core.debug("labeled:"+this._eventsToCheck.indexOf("labeled")); //remove
    }

    public async getAllIssuesForRepo(labels: string): Promise<{ result: Issue[], operations: number }> {
        return this.getAllResult(async (page) => {
            return await this._client.issues.listForRepo({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                state: 'open',
                per_page: 100,
                page: page,
                labels: labels
            });
        })
    }

    public async addLabelToIssueWithComment(issue: Issue, message: string, label: string): Promise<number> {
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

    public async checkIssueLastUpdatedByCollaborator(issue: Issue): Promise<{ result: boolean; operations: number }> {
        let operations = 0;
        operations += await this.ensureCollaboratorList();
        const allComments = await this.getAllCommentsForIssue(issue);
        operations += allComments.operations;
        let issueTimeline = allComments.result;
        core.debug("initial length:"+issueTimeline.length);
        if (this._eventsToCheck.length > 0) {
            const allEvents = await this.getAllEventsForIssue(issue);
            operations += allEvents.operations;
            core.debug("initial event length:"+allEvents.result.length);
            issueTimeline.concat(...allEvents.result);
        }

        core.debug("issue timeline length:"+issueTimeline.length);
        const latestEvent = issueTimeline.reduce((prev, current) =>
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
            if (!this._ignoreEventsFromBot || comment.user.type !== "Bot") {
                commentEvents.push(new IssueEvent(comment.user.login, "commented", new Date(comment.created_at)));
            }
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
        core.debug("event length:"+allEvents.result.length); //remove

        let issueEvents: IssueEvent[] = [];
        for (var event of allEvents.result) {
            core.debug("for loop");
            if (!this._ignoreEventsFromBot || event.actor.type !== "Bot") {
                core.debug("non bot");
                core.debug("event name:"+event.event);
                core.debug("check result:"+this._eventsToCheck.indexOf(event.event));
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
        }
        core.debug("filtered event length:"+issueEvents.length);
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