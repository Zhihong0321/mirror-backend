/** Identification required by the myworker job API. */
export function workerIdentification(taskDescription: string) {
  return { callerId: 'mirrormirror', taskDescription };
}
