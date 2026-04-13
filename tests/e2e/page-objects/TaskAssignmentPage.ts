export class TaskAssignmentPage {
  constructor(readonly taskId: string) {}

  assignmentPath(): string {
    return `/tasks/${encodeURIComponent(this.taskId)}/assignment`;
  }

  taskPath(): string {
    return `/tasks/${encodeURIComponent(this.taskId)}`;
  }
}
