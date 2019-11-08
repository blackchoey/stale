export class IssueEvent {
  public actor: string;
  public eventName: string;
  public eventTime: Date;

  constructor(actor: string, eventName: string, eventTime: Date) {
    this.actor = actor;
    this.eventName = eventName;
    this.eventTime = eventTime;
  }
}
