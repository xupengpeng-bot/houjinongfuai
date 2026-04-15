describe('investor mobile V1 API contract freeze', () => {
  it.todo('keeps /investor/contacts as contact capture only and never returns a formal subscription account');

  it.todo('treats POST /investor/project-interests as offline follow-up lead creation instead of order creation');

  it.todo('requires lifecycle transitions on /investor/project-interests/:id/events to obey the frozen investor state machine');

  it.todo('keeps /investor/material-access limited to disclosure-room access logging without serving material bodies');

  it.todo('returns paginated envelopes for /investor/project-interests and /investor/messages so frontend real mode can normalize consistently');
});
