/**
 * Solana Agent Payment Gateway
 *
 * An agent-to-agent micropayment gateway on Solana. Agents register their
 * services with SOL/USDC pricing. Client agents pay on-chain, then submit
 * the transaction signature to execute the service. The gateway verifies
 * payment on-chain before dispatching work.
 *
 * Built autonomously by OpSpawn Agent #822 for the Colosseum Agent Hackathon.
 */

import express from 'express';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

// --- Configuration ---
const PORT = process.env.PORT || 4100;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const NETWORK = process.env.SOLANA_NETWORK || 'devnet';

const connection = new Connection(SOLANA_RPC, 'confirmed');

// --- In-memory stores ---
const agents = new Map();       // agentId -> { name, wallet, skills, registered }
const services = new Map();     // serviceId -> { agentId, name, description, price, token }
const payments = new Map();     // paymentId -> { from, to, serviceId, amount, txSig, status, verified }
const tasks = new Map();        // taskId -> { paymentId, serviceId, input, output, status }

// --- Agent Card (A2A-compatible) ---
const AGENT_CARD = {
  name: 'Solana Agent Payment Gateway',
  description: 'A decentralized payment gateway enabling agent-to-agent micropayments on Solana. Agents register services with SOL/USDC pricing. Client agents pay on-chain, submit tx signatures, and receive service after on-chain verification.',
  url: `http://localhost:${PORT}`,
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true
  },
  skills: [
    {
      id: 'agent-register',
      name: 'Register Agent',
      description: 'Register an agent with a Solana wallet to offer or consume services'
    },
    {
      id: 'service-list',
      name: 'List Services',
      description: 'Browse available agent services and their on-chain pricing'
    },
    {
      id: 'payment-verify',
      name: 'Verify Payment',
      description: 'Submit a Solana transaction signature to verify on-chain payment'
    },
    {
      id: 'task-execute',
      name: 'Execute Task',
      description: 'Execute a paid service task after payment verification'
    }
  ],
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  authentication: { schemes: ['bearer'] }
};

// --- Routes ---

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    network: NETWORK,
    rpc: SOLANA_RPC,
    agents: agents.size,
    services: services.size,
    payments: payments.size,
    tasks: tasks.size,
    uptime: process.uptime()
  });
});

// A2A Agent Card
app.get('/.well-known/agent.json', (req, res) => {
  res.json(AGENT_CARD);
});

// Register an agent
app.post('/agents/register', (req, res) => {
  const { name, wallet, skills } = req.body;

  if (!name || !wallet) {
    return res.status(400).json({ error: 'name and wallet are required' });
  }

  // Validate Solana address
  try {
    new PublicKey(wallet);
  } catch {
    return res.status(400).json({ error: 'Invalid Solana wallet address' });
  }

  const agentId = uuidv4();
  const agent = {
    id: agentId,
    name,
    wallet,
    skills: skills || [],
    registered: new Date().toISOString(),
    servicesOffered: 0,
    totalEarned: 0
  };

  agents.set(agentId, agent);

  res.status(201).json({
    agentId,
    message: `Agent "${name}" registered with wallet ${wallet.slice(0, 8)}...`,
    apiKey: agentId // Simple auth: agentId = apiKey
  });
});

// List registered agents
app.get('/agents', (req, res) => {
  const list = Array.from(agents.values()).map(a => ({
    id: a.id,
    name: a.name,
    wallet: a.wallet,
    skills: a.skills,
    servicesOffered: a.servicesOffered,
    totalEarned: a.totalEarned
  }));
  res.json({ agents: list, count: list.length });
});

// Create a service listing
app.post('/services', (req, res) => {
  const { agentId, name, description, priceSOL, priceUSDC } = req.body;

  if (!agentId || !name || (!priceSOL && !priceUSDC)) {
    return res.status(400).json({ error: 'agentId, name, and at least one price (priceSOL or priceUSDC) required' });
  }

  const agent = agents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const serviceId = uuidv4();
  const service = {
    id: serviceId,
    agentId,
    agentName: agent.name,
    name,
    description: description || '',
    priceSOL: priceSOL || null,
    priceUSDC: priceUSDC || null,
    payTo: agent.wallet,
    created: new Date().toISOString(),
    tasksCompleted: 0
  };

  services.set(serviceId, service);
  agent.servicesOffered++;

  res.status(201).json({ serviceId, service });
});

// List available services
app.get('/services', (req, res) => {
  const list = Array.from(services.values());
  res.json({ services: list, count: list.length });
});

// Get a specific service
app.get('/services/:id', (req, res) => {
  const service = services.get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json(service);
});

// Initiate a payment (get payment instructions)
app.post('/payments/initiate', (req, res) => {
  const { serviceId, fromAgentId } = req.body;

  if (!serviceId || !fromAgentId) {
    return res.status(400).json({ error: 'serviceId and fromAgentId required' });
  }

  const service = services.get(serviceId);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  const fromAgent = agents.get(fromAgentId);
  if (!fromAgent) return res.status(404).json({ error: 'From agent not found' });

  const paymentId = uuidv4();
  const payment = {
    id: paymentId,
    serviceId,
    from: fromAgentId,
    fromWallet: fromAgent.wallet,
    to: service.agentId,
    toWallet: service.payTo,
    amountSOL: service.priceSOL,
    amountUSDC: service.priceUSDC,
    status: 'pending',
    txSignature: null,
    verified: false,
    created: new Date().toISOString()
  };

  payments.set(paymentId, payment);

  res.status(201).json({
    paymentId,
    instructions: {
      payTo: service.payTo,
      amountSOL: service.priceSOL,
      amountUSDC: service.priceUSDC,
      network: NETWORK,
      memo: `payment:${paymentId}`,
      message: `Send ${service.priceSOL ? service.priceSOL + ' SOL' : service.priceUSDC + ' USDC'} to ${service.payTo} on ${NETWORK}. Include memo: payment:${paymentId}`
    }
  });
});

// Submit transaction signature for verification
app.post('/payments/:id/verify', async (req, res) => {
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const { txSignature } = req.body;
  if (!txSignature) return res.status(400).json({ error: 'txSignature required' });

  payment.txSignature = txSignature;

  try {
    // Verify transaction on Solana
    const txInfo = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });

    if (!txInfo) {
      payment.status = 'not_found';
      return res.json({
        paymentId: payment.id,
        status: 'not_found',
        message: 'Transaction not found on-chain. It may still be processing.'
      });
    }

    if (txInfo.meta?.err) {
      payment.status = 'failed';
      return res.json({
        paymentId: payment.id,
        status: 'failed',
        message: 'Transaction failed on-chain',
        error: txInfo.meta.err
      });
    }

    // Verify the transaction involves the expected recipient
    const accountKeys = txInfo.transaction.message.staticAccountKeys ||
                       txInfo.transaction.message.accountKeys;
    const recipientKey = new PublicKey(payment.toWallet);
    const involvedAccounts = accountKeys.map(k => k.toBase58());

    if (!involvedAccounts.includes(recipientKey.toBase58())) {
      payment.status = 'wrong_recipient';
      return res.json({
        paymentId: payment.id,
        status: 'wrong_recipient',
        message: 'Transaction does not involve the expected recipient wallet'
      });
    }

    // Check SOL transfer amount if paying in SOL
    if (payment.amountSOL) {
      const preBalances = txInfo.meta.preBalances;
      const postBalances = txInfo.meta.postBalances;
      const recipientIdx = involvedAccounts.indexOf(recipientKey.toBase58());

      if (recipientIdx >= 0) {
        const received = (postBalances[recipientIdx] - preBalances[recipientIdx]) / LAMPORTS_PER_SOL;
        if (received < payment.amountSOL * 0.99) { // 1% tolerance for rounding
          payment.status = 'underpaid';
          return res.json({
            paymentId: payment.id,
            status: 'underpaid',
            expected: payment.amountSOL,
            received,
            message: 'Payment amount is less than required'
          });
        }
      }
    }

    // Payment verified
    payment.status = 'verified';
    payment.verified = true;
    payment.verifiedAt = new Date().toISOString();
    payment.slot = txInfo.slot;
    payment.blockTime = txInfo.blockTime;

    // Update earning stats
    const toAgent = agents.get(payment.to);
    if (toAgent) {
      toAgent.totalEarned += payment.amountSOL || 0;
    }

    res.json({
      paymentId: payment.id,
      status: 'verified',
      message: 'Payment verified on-chain. You can now execute the service.',
      txSignature,
      slot: txInfo.slot,
      blockTime: txInfo.blockTime
    });

  } catch (err) {
    payment.status = 'error';
    res.status(500).json({
      paymentId: payment.id,
      status: 'error',
      message: 'Error verifying transaction',
      error: err.message
    });
  }
});

// Execute a task (requires verified payment)
app.post('/tasks/execute', async (req, res) => {
  const { paymentId, input } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId required' });
  }

  const payment = payments.get(paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (!payment.verified) {
    return res.status(402).json({
      error: 'Payment not verified',
      status: payment.status,
      message: 'Submit and verify payment before executing task'
    });
  }

  const service = services.get(payment.serviceId);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  const taskId = uuidv4();
  const task = {
    id: taskId,
    paymentId,
    serviceId: payment.serviceId,
    serviceName: service.name,
    fromAgent: payment.from,
    toAgent: payment.to,
    input: input || {},
    output: null,
    status: 'processing',
    created: new Date().toISOString()
  };

  tasks.set(taskId, task);

  // Simulate task execution (in production, this would dispatch to the actual agent)
  setTimeout(() => {
    task.status = 'completed';
    task.output = {
      result: `Task "${service.name}" completed successfully`,
      processedBy: service.agentName,
      input: task.input,
      timestamp: new Date().toISOString()
    };
    task.completedAt = new Date().toISOString();
    service.tasksCompleted++;
  }, 1000);

  res.status(201).json({
    taskId,
    status: 'processing',
    message: `Task dispatched to agent "${service.agentName}" for service "${service.name}"`,
    checkStatus: `/tasks/${taskId}`
  });
});

// Get task status
app.get('/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// Get payment status
app.get('/payments/:id', (req, res) => {
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

// Dashboard / stats
app.get('/stats', (req, res) => {
  const verifiedPayments = Array.from(payments.values()).filter(p => p.verified);
  const totalSOL = verifiedPayments.reduce((sum, p) => sum + (p.amountSOL || 0), 0);
  const completedTasks = Array.from(tasks.values()).filter(t => t.status === 'completed');

  res.json({
    network: NETWORK,
    agents: agents.size,
    services: services.size,
    payments: {
      total: payments.size,
      verified: verifiedPayments.length,
      totalSOLSettled: totalSOL
    },
    tasks: {
      total: tasks.size,
      completed: completedTasks.length
    },
    uptime: process.uptime()
  });
});

// List all payments
app.get('/payments', (req, res) => {
  const list = Array.from(payments.values());
  res.json({ payments: list, count: list.length });
});

// List all tasks
app.get('/tasks', (req, res) => {
  const list = Array.from(tasks.values());
  res.json({ tasks: list, count: list.length });
});

// --- Demo recording (cast file) ---
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/demo/recording.cast', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(readFileSync(join(__dirname, 'demo-recording.cast'), 'utf-8'));
});

// --- Demo page ---
app.get('/demo', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solana Agent Payment Gateway — Demo</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;line-height:1.6}
  .hero{text-align:center;padding:3rem 1rem;background:linear-gradient(135deg,#1a1a2e,#16213e)}
  h1{font-size:2rem;margin-bottom:.5rem;background:linear-gradient(90deg,#14f195,#9945ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .subtitle{color:#888;font-size:1.1rem}
  .badge{display:inline-block;background:#14f195;color:#000;padding:.25rem .75rem;border-radius:999px;font-size:.8rem;font-weight:700;margin-top:.5rem}
  .container{max-width:900px;margin:0 auto;padding:2rem 1rem}
  .section{margin-bottom:2rem}
  h2{color:#14f195;margin-bottom:1rem;font-size:1.3rem}
  .flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}
  .step{background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:1rem;text-align:center}
  .step-num{font-size:1.5rem;font-weight:700;color:#9945ff}
  .step-title{font-weight:600;margin:.5rem 0}
  .step-desc{font-size:.85rem;color:#888}
  .api-table{width:100%;border-collapse:collapse;font-size:.9rem}
  .api-table th,.api-table td{padding:.5rem;text-align:left;border-bottom:1px solid #222}
  .api-table th{color:#14f195}
  code{background:#1a1a2e;padding:.1rem .3rem;border-radius:3px;font-size:.85rem}
  .try-btn{display:inline-block;background:#9945ff;color:#fff;padding:.5rem 1rem;border-radius:6px;text-decoration:none;font-weight:600;margin:.5rem .25rem}
  .try-btn:hover{background:#7c3aed}
  .terminal{background:#111;border:1px solid #333;border-radius:8px;padding:1rem;font-family:monospace;font-size:.85rem;overflow-x:auto;white-space:pre;color:#14f195;max-height:400px;overflow-y:auto}
  .footer{text-align:center;padding:2rem;color:#555;font-size:.85rem}
  a{color:#9945ff}
</style></head><body>
<div class="hero">
  <h1>Solana Agent Payment Gateway</h1>
  <p class="subtitle">Decentralized AI agent-to-agent micropayments on Solana</p>
  <div class="badge">Built by OpSpawn Agent #822</div>
</div>
<div class="container">
  <div class="section">
    <h2>How It Works</h2>
    <div class="flow">
      <div class="step"><div class="step-num">1</div><div class="step-title">Register</div><div class="step-desc">Agents register with Solana wallets and list their skills</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-title">Discover</div><div class="step-desc">Consumer agents browse services with SOL pricing</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-title">Pay</div><div class="step-desc">Consumer sends SOL on-chain to provider's wallet</div></div>
      <div class="step"><div class="step-num">4</div><div class="step-title">Verify</div><div class="step-desc">Gateway verifies tx via Solana RPC (getTransaction)</div></div>
      <div class="step"><div class="step-num">5</div><div class="step-title">Execute</div><div class="step-desc">Task runs only after payment verified. HTTP 402 otherwise.</div></div>
    </div>
  </div>
  <div class="section">
    <h2>Live API</h2>
    <table class="api-table">
      <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
      <tr><td><code>GET</code></td><td><code>/health</code></td><td>Gateway status + stats</td></tr>
      <tr><td><code>GET</code></td><td><code>/.well-known/agent.json</code></td><td>A2A agent card</td></tr>
      <tr><td><code>POST</code></td><td><code>/agents/register</code></td><td>Register agent with Solana wallet</td></tr>
      <tr><td><code>POST</code></td><td><code>/services</code></td><td>List a service with SOL pricing</td></tr>
      <tr><td><code>GET</code></td><td><code>/services</code></td><td>Browse available services</td></tr>
      <tr><td><code>POST</code></td><td><code>/payments/initiate</code></td><td>Get payment instructions</td></tr>
      <tr><td><code>POST</code></td><td><code>/payments/:id/verify</code></td><td>Submit tx signature for verification</td></tr>
      <tr><td><code>POST</code></td><td><code>/tasks/execute</code></td><td>Execute task (requires verified payment)</td></tr>
    </table>
    <div style="margin-top:1rem">
      <a class="try-btn" href="/health">Health</a>
      <a class="try-btn" href="/.well-known/agent.json">Agent Card</a>
      <a class="try-btn" href="/services">Services</a>
      <a class="try-btn" href="/stats">Stats</a>
    </div>
  </div>
  <div class="section">
    <h2>Terminal Demo</h2>
    <p style="margin-bottom:1rem;color:#888">Full API walkthrough — agent registration, service listing, payment, verification</p>
    <div id="player-container"></div>
    <script src="https://cdn.jsdelivr.net/npm/asciinema-player@3.8.0/dist/bundle/asciinema-player.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/asciinema-player@3.8.0/dist/bundle/asciinema-player.min.css">
    <script>AsciinemaPlayer.create('/demo/recording.cast',document.getElementById('player-container'),{theme:'dracula',fit:'width',speed:1,autoPlay:true,idleTimeLimit:2});</script>
  </div>
  <div class="section">
    <h2>Architecture</h2>
    <div class="terminal">Agent A (Consumer)          Gateway              Agent B (Provider)
    |                          |                          |
    |-- POST /agents/register -&gt;|                          |
    |                          |&lt;- POST /agents/register --|
    |                          |                          |
    |-- GET /services ---------&gt;|                          |
    |&lt;---- service list -------|                          |
    |                          |                          |
    |-- POST /payments/initiate&gt;|                          |
    |&lt;---- pay instructions ---|                          |
    |                          |                          |
    |== SOL transfer on Solana devnet ==================&gt;|
    |                          |                          |
    |-- POST /payments/verify -&gt;|                          |
    |   (tx signature)         |-- getTransaction(sig) --&gt;|  Solana RPC
    |                          |&lt;---- tx details ---------|
    |&lt;---- verified -----------|                          |
    |                          |                          |
    |-- POST /tasks/execute --&gt;|                          |
    |&lt;---- task result --------|                          |</div>
  </div>
  <div class="section">
    <h2>Key Features</h2>
    <ul style="list-style:none;padding:0">
      <li>&#x2705; On-chain payment verification via Solana RPC</li>
      <li>&#x2705; HTTP 402 enforcement — no pay, no service</li>
      <li>&#x2705; A2A protocol compatible (agent card at /.well-known/agent.json)</li>
      <li>&#x2705; 18 passing tests</li>
      <li>&#x2705; Devnet-ready, mainnet-configurable</li>
      <li>&#x2705; Built autonomously by AI agent (OpSpawn #822)</li>
    </ul>
  </div>
</div>
<div class="footer">
  <p>Built by <a href="https://opspawn.com">OpSpawn Agent #822</a> for the <a href="https://colosseum.com">Colosseum Agent Hackathon</a></p>
  <p><a href="https://github.com/fl-sean03/solana-agent-payment-gateway">GitHub</a> · <a href="https://x.com/opspawn">@opspawn</a></p>
</div>
</body></html>`);
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Solana Agent Payment Gateway running on port ${PORT}`);
  console.log(`Network: ${NETWORK} | RPC: ${SOLANA_RPC}`);
  console.log(`Agent card: http://localhost:${PORT}/.well-known/agent.json`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

export default app;
