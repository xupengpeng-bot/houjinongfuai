function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveRuntimeShadowWorkflowState(input: {
  payload?: Record<string, unknown> | null;
  controllerState?: Record<string, unknown> | null;
}) {
  const payload = input.payload ?? {};
  const controllerState = input.controllerState ?? {};

  return (
    asString(payload.workflow_state) ||
    asString(payload.workflowState) ||
    asString(controllerState.workflow_state) ||
    asString(controllerState.workflowState) ||
    null
  );
}
