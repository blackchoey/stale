"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Constants {
}
Constants.UserType = {
    Collaborator: 'collaborator',
    NonCollaborator: 'non-collaborator'
};
Constants.AvailableLastCommentedUserTypes = [
    Constants.UserType.Collaborator,
    Constants.UserType.NonCollaborator
];
exports.Constants = Constants;
