import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {FreecadMcpManager} from './service.js';
import {exactKeys, FreecadMcpError} from './settings.js';

export function createFreecadMcpRoutes(manager?: FreecadMcpManager): Hono {
  const app = new Hono();
  let owned = manager;
  const service = () => owned ??= new FreecadMcpManager();
  app.use('*', bodyLimit({maxSize: 32768, onError: c => c.json({code: 'request_too_large', detail: '请求超过安全上限'}, 413)}));
  app.use('*', async (c, next) => {
    if (['POST', 'PUT'].includes(c.req.method) && !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') || ''))
      return c.json({code: 'invalid_content_type', detail: '请求必须使用 JSON'}, 400);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof FreecadMcpError) return c.json({code: error.code, detail: error.message,
      ...(error.code === 'outcome_unknown' ? {execution_state: 'unknown'} : {})}, error.status);
    return c.json({code: 'mcp_operation_failed', detail: 'MCP 管理操作未完成；请重新检测当前状态'}, 500);
  });
  const body = async (c: {req: {json: () => Promise<unknown>}}, keys: string[]) => {
    let value: unknown;
    try { value = await c.req.json(); } catch { throw new FreecadMcpError('invalid_json', 'JSON 请求无效'); }
    exactKeys(value, keys); return value;
  };
  app.get('/status', c => c.json(service().status()));
  app.put('/settings', async c => { const b = await body(c, ['settings', 'expected_revision']); return c.json(service().save(b.settings, b.expected_revision)); });
  app.post('/install/preview', async c => { const b = await body(c, ['revision']); return c.json(await service().preview(b.revision)); });
  app.post('/install/apply', async c => { const b = await body(c, ['plan_id', 'confirmed']); return c.json(await service().apply(b.plan_id, b.confirmed)); });
  app.post('/connection/check', async c => { const b = await body(c, ['revision']); return c.json(await service().check(b.revision, c.req.raw.signal)); });
  app.post('/instance/start', async c => { const b = await body(c, ['revision', 'confirmed']); return c.json(service().start(b.revision, b.confirmed), 202); });
  app.post('/instance/stop', async c => { const b = await body(c, ['id', 'confirmed']); return c.json(await service().stop(b.id, b.confirmed)); });
  return app;
}
export const freecadMcpRoutes = createFreecadMcpRoutes();
