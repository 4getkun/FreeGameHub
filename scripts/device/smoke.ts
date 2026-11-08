export function assertSmokeResult(rendered: boolean, errors: string[], failedRequests: string[]): void {
  if (!rendered) throw new Error('検証用ゲームが表示されません');
  if (errors.length || failedRequests.length) throw new Error(JSON.stringify({ errors, failedRequests }));
}
