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
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const constants_1 = require("./constants");
const githubRepo_1 = require("./githubRepo");
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const args = getAndValidateArgs();
            const client = new github.GitHub(args.repoToken);
            const githubRepo = new githubRepo_1.GithubRepo(client, args.eventsForCollaborators);
            yield processIssues(githubRepo, args);
        }
        catch (error) {
            core.error(error);
            core.setFailed(error.message);
        }
    });
}
function processIssues(githubRepo, args) {
    return __awaiter(this, void 0, void 0, function* () {
        let operationsLeft = args.operationsPerRun;
        const issues = yield githubRepo.getAllIssuesForRepo(args.onlyLabels);
        operationsLeft -= issues.operations;
        if (issues.result.length === 0) {
            core.debug(`No open issues found with configured filter.`);
            return;
        }
        if (operationsLeft <= 0) {
            core.debug(`Reaches max operations limit after list all issues. Please increase the operations-per-run.`);
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
                core.debug(`Found exempt label for issue ${issue.title}. Skip processing.`);
                continue;
            }
            else if (isLabeled(issue, staleLabel)) {
                if (wasLastUpdatedBefore(issue, args.daysBeforeClose)) {
                    var lastCommentFilterResult = yield wasLastUpdatedByGivenUserType(githubRepo, issue, args.lastUpdatedUserType);
                    operationsLeft -= lastCommentFilterResult.operations;
                    if (lastCommentFilterResult.result) {
                        operationsLeft -= yield githubRepo.closeIssue(issue);
                    }
                    else {
                        core.debug(`Not match last-updated-user-type. Skip closing.`);
                    }
                }
                else {
                    continue;
                }
            }
            else if (wasLastUpdatedBefore(issue, args.daysBeforeStale)) {
                var lastCommentFilterResult = yield wasLastUpdatedByGivenUserType(githubRepo, issue, args.lastUpdatedUserType);
                operationsLeft -= lastCommentFilterResult.operations;
                if (lastCommentFilterResult.result) {
                    operationsLeft -= yield githubRepo.addLabelToIssueWithComment(issue, staleMessage, staleLabel);
                }
                else {
                    core.debug(`Not match last-updated-user-type. Skip marking stale.`);
                }
            }
            if (operationsLeft <= 0) {
                core.warning(`Performed ${args.operationsPerRun} operations, exiting to avoid rate limit`);
            }
        }
    });
}
function isLabeled(issue, label) {
    const labelComparer = l => label.localeCompare(l.name, undefined, { sensitivity: 'accent' }) === 0;
    return issue.labels.filter(labelComparer).length > 0;
}
function wasLastUpdatedBefore(issue, num_days) {
    const daysInMillis = 1000 * 60 * 60 * 24 * num_days;
    const millisSinceLastUpdated = new Date().getTime() - new Date(issue.updated_at).getTime();
    return millisSinceLastUpdated >= daysInMillis;
}
function wasLastUpdatedByGivenUserType(githubRepo, issue, lastUpdatedUserType) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!lastUpdatedUserType ||
            constants_1.Constants.AvailableLastCommentedUserTypes.indexOf(lastUpdatedUserType) ===
                -1) {
            core.debug('Last comment user type is not set or not valid. Skip last updated user type filter.');
            return { result: true, operations: 0 };
        }
        const lastUpdatedByCollaborator = yield githubRepo.checkIssueLastUpdatedByCollaborator(issue);
        return {
            result: lastUpdatedUserType === constants_1.Constants.UserType.Collaborator ? lastUpdatedByCollaborator.result : !lastUpdatedByCollaborator.result,
            operations: lastUpdatedByCollaborator.operations
        };
    });
}
function getAndValidateArgs() {
    const args = {
        repoToken: core.getInput('repo-token', { required: true }),
        staleIssueMessage: core.getInput('stale-issue-message'),
        stalePrMessage: core.getInput('stale-pr-message'),
        daysBeforeStale: parseInt(core.getInput('days-before-stale', { required: true })),
        daysBeforeClose: parseInt(core.getInput('days-before-close', { required: true })),
        staleIssueLabel: core.getInput('stale-issue-label', { required: true }),
        exemptIssueLabel: core.getInput('exempt-issue-label'),
        stalePrLabel: core.getInput('stale-pr-label', { required: true }),
        exemptPrLabel: core.getInput('exempt-pr-label'),
        operationsPerRun: parseInt(core.getInput('operations-per-run', { required: true })),
        lastUpdatedUserType: core.getInput('last-updated-user-type'),
        onlyLabels: core.getInput('only-labels'),
        eventsForCollaborators: core.getInput('include-events-from-collaborators').split(",")
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
