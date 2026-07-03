import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const executaDir = join(root, 'executas', 'mini-notes-summary-go');
const proc = spawn('go', ['run', '.'], { cwd: executaDir, stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: proc.stdout });

const pending = new Map();
let sawSampling = false;

function send(msg) {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
}

function waitFor(id) {
  return new Promise((resolve, reject) => {
    pending.set(String(id), resolve);
    setTimeout(() => reject(new Error(`Timed out waiting for id ${id}`)), 5000);
  });
}

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'sampling/createMessage') {
    sawSampling = true;
    const prompt = msg.params?.messages?.[0]?.content?.text ?? '';
    if (!prompt.includes('客户') && !prompt.includes('login')) {
      throw new Error('sampling prompt did not contain note contents');
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        role: 'assistant',
        content: { type: 'text', text: 'Mock summary from manual-rpc: customer follow-up and login bug are the top priorities.' },
        model: 'manual-rpc-mock',
        stopReason: 'endTurn'
      }
    });
    return;
  }
  const key = String(msg.id);
  const resolve = pending.get(key);
  if (resolve) {
    pending.delete(key);
    resolve(msg);
  }
});

proc.stderr.on('data', (chunk) => process.stderr.write(chunk));

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2.0' } });
const init = await waitFor(1);
if (init.result?.protocolVersion !== '2.0') throw new Error('initialize did not negotiate v2');
if (!init.result?.client_capabilities?.sampling) throw new Error('initialize did not declare client_capabilities.sampling');

send({ jsonrpc: '2.0', id: 2, method: 'describe' });
const desc = await waitFor(2);
if (desc.result?.name !== 'mini-notes-summary') throw new Error('describe name mismatch');
if (!desc.result?.host_capabilities?.includes('llm.sample')) throw new Error('describe missing llm.sample');
const summarize = desc.result?.tools?.find((tool) => tool.name === 'summarize');
if (!summarize?.parameters) throw new Error('summarize tool missing parameters[] schema');

send({
  jsonrpc: '2.0',
  id: 3,
  method: 'invoke',
  params: {
    method: 'summarize',
    invoke_id: 'manual-rpc-001',
    args: {
      notes: [
        { order: 1, content: '明天跟客户 follow up' },
        { order: 2, content: '修复 login bug' }
      ]
    }
  }
});
const invoked = await waitFor(3);
if (!sawSampling) throw new Error('invoke did not emit sampling/createMessage');
if (!invoked.result?.summary?.includes('Mock summary')) throw new Error('invoke summary did not come from sampling response');

send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
await waitFor(4);
proc.stdin.end();
console.log('manual-rpc OK: initialize, describe, invoke, and sampling/createMessage verified');
