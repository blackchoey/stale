"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const github = __importStar(require("@actions/github"));
const issueEvent_1 = require("./models/issueEvent");
const core = __importStar(require("@actions/core")); //remove
// Cache GitHub repo related information and perfor 
class GithubRepo {
    constructor(client, eventsToCheck) {
        this._ignoreEventsFromBot = true;
        this._client = client;
        this._eventsToCheck = eventsToCheck;
        this._collaborators = [];
        core.debug("events to check length: " + this._eventsToCheck.length); //remove
        core.debug("events to check:" + this._eventsToCheck.toString); //remove
        core.debug("labeled:" + this._eventsToCheck.indexOf("labeled")); //remove
    }
    getAllIssuesForRepo(labels) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.getAllResult((page) => __awaiter(this, void 0, void 0, function* () {
                return yield this._client.issues.listForRepo({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    state: 'open',
                    per_page: 100,
                    page: page,
                    labels: labels
                });
            }));
        });
    }
    addLabelToIssueWithComment(issue, message, label) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._client.issues.createComment({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: issue.number,
                body: message
            });
            yield this._client.issues.addLabels({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: issue.number,
                labels: [label]
            });
            return 2; // operations performed
        });
    }
    closeIssue(issue) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._client.issues.update({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: issue.number,
                state: 'closed'
            });
            return 1; // operations performed
        });
    }
    checkIssueLastUpdatedByCollaborator(issue) {
        return __awaiter(this, void 0, void 0, function* () {
            let operations = 0;
            operations += yield this.ensureCollaboratorList();
            const allComments = yield this.getAllCommentsForIssue(issue);
            operations += allComments.operations;
            let issueTimeline = allComments.result;
            if (this._eventsToCheck.length > 0) {
                const allEvents = yield this.getAllEventsForIssue(issue);
                operations += allEvents.operations;
                issueTimeline.concat(allEvents.result);
            }
            const latestEvent = issueTimeline.reduce((prev, current) => prev.eventTime > current.eventTime ? prev : current);
            if (this._collaborators.indexOf(latestEvent.actor) !== -1) {
                return {
                    result: true,
                    operations: operations
                };
            }
            else {
                return {
                    result: false,
                    operations: operations
                };
            }
        });
    }
    getAllCommentsForIssue(issue) {
        return __awaiter(this, void 0, void 0, function* () {
            const allComments = yield this.getAllResult((page) => __awaiter(this, void 0, void 0, function* () {
                return yield this._client.issues.listComments({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    issue_number: issue.number,
                    per_page: 100,
                    page: page
                });
            }));
            let commentEvents = [];
            for (var comment of allComments.result) {
                if (!this._ignoreEventsFromBot || comment.user.type !== "Bot") {
                    commentEvents.push(new issueEvent_1.IssueEvent(comment.user.login, "commented", new Date(comment.created_at)));
                }
            }
            return {
                result: commentEvents,
                operations: allComments.operations
            };
        });
    }
    getAllEventsForIssue(issue) {
        return __awaiter(this, void 0, void 0, function* () {
            const allEvents = yield this.getAllResult((page) => __awaiter(this, void 0, void 0, function* () {
                return yield this._client.issues.listEvents({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    issue_number: issue.number,
                    per_page: 100,
                    page: page
                });
            }));
            core.debug("event length:" + allEvents.result.length); //remove
            let issueEvents = [];
            for (var event of allEvents.result) {
                core.debug("for loop");
                if (!this._ignoreEventsFromBot || event.actor.type !== "Bot") {
                    core.debug("non bot");
                    if (this._eventsToCheck.indexOf(event.event) !== -1) {
                        switch (event.event) {
                            case "assigned":
                            case "unassigned":
                                // TODO: Get actual assigner as actor when github client returns required info in the future.
                                let actor = event.actor.login;
                                issueEvents.push(new issueEvent_1.IssueEvent(actor, event.event, new Date(event.created_at)));
                                break;
                            default:
                                issueEvents.push(new issueEvent_1.IssueEvent(event.actor.login, event.event, new Date(event.created_at)));
                                break;
                        }
                    }
                }
            }
            return {
                result: issueEvents,
                operations: allEvents.operations
            };
        });
    }
    ensureCollaboratorList() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._collaborators.length > 0) {
                return 0; // Already pulled collaborators list
            }
            var result = yield this.getAllResult((page) => __awaiter(this, void 0, void 0, function* () {
                return yield this._client.repos.listCollaborators({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    per_page: 100,
                    page: page
                });
            }));
            for (var collaborator of result.result) {
                this._collaborators.push(collaborator.login);
            }
            return result.operations;
        });
    }
    getAllResult(request) {
        return __awaiter(this, void 0, void 0, function* () {
            let allResult = [];
            let page = 1;
            let operations = 0;
            let requestResult = yield request(page);
            operations++;
            page++;
            while (requestResult.data.length !== 0) {
                for (var item of requestResult.data.values()) {
                    allResult.push(item);
                }
                requestResult = yield request(page);
                operations++;
                page++;
            }
            return {
                result: allResult,
                operations: operations
            };
        });
    }
}
exports.GithubRepo = GithubRepo;