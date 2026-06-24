async function approveExecutionContractWithRetry(ctx, helpers, taskId) {
  const { apiSend, runProjectionCatchUp } = helpers;
  const approvalBody = {
    autoApproval: true,
    approvalNote: 'Golden path Phase 1 policy auto-approval for low-risk Simple docs pilot.',
  };
  let lastResponse = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    lastResponse = await apiSend(
      ctx,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/execution-contract/approve`,
      'POST',
      ['pm', 'reader'],
      approvalBody,
    );
    if (lastResponse.ok) return lastResponse;
    const missingContract = lastResponse.status === 404
      && lastResponse.body?.error?.code === 'execution_contract_not_found';
    if (!missingContract || attempt === 3) return lastResponse;
    await runProjectionCatchUp(ctx, `execution-contract-approve-retry-${attempt + 1}`);
  }
  return lastResponse;
}

module.exports = {
  approveExecutionContractWithRetry,
};