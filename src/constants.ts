export class Constants {
  public static UserType = {
    Collaborator: 'collaborator',
    NonCollaborator: 'non-collaborator'
  };

  public static AvailableLastCommentedUserTypes: string[] = [
    Constants.UserType.Collaborator,
    Constants.UserType.NonCollaborator
  ];
}
