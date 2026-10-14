import { handleTeamAdmin } from '../team-admin/handler.ts';

// Main service for the self-hosted Edge Runtime. The proxy strips functions/v1.
Deno.serve((request) => {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (path === '/team-admin' || path === '/functions/v1/team-admin') return handleTeamAdmin(request);
  if (path === '/health') return new Response('ok');
  return new Response(JSON.stringify({ error: 'Function not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
});
