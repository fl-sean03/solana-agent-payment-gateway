/**
 * Solana Agent Payment Gateway — Demo Flow
 *
 * Demonstrates the complete agent-to-agent payment lifecycle:
 * 1. Two agents register with Solana wallets
 * 2. Provider agent lists a service with SOL pricing
 * 3. Consumer agent initiates payment
 * 4. Payment instructions returned (pay-to address + amount)
 * 5. Consumer sends SOL on-chain and submits tx signature
 * 6. Gateway verifies payment on Solana
 * 7. Task executes after verification
 *
 * Run: node demo.mjs [--live-tx <signature>]
 */

const BASE = process.env.BASE_URL || 'http://localhost:4100';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  return res.json();
}

function log(step, msg, data) {
  console.log(`\n[${'Step ' + step}] ${msg}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

async function demo() {
  console.log('='.repeat(60));
  console.log(' Solana Agent Payment Gateway — Live Demo');
  console.log(' Network: devnet | Protocol: A2A + Solana SPL');
  console.log('='.repeat(60));

  // Step 1: Register provider agent
  log(1, 'Registering Screenshot Agent (service provider)...');
  const providerRes = await api('/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'OpSpawn Screenshot Agent',
      wallet: 'E4h1FDHx647Ra33WSsvNwUVXDAm99Ne64xWK2FvbWnsP',
      skills: ['screenshot', 'pdf-generation', 'markdown-to-html']
    })
  });
  log(1, 'Provider registered:', { agentId: providerRes.agentId, name: 'OpSpawn Screenshot Agent' });

  // Step 2: Register consumer agent
  log(2, 'Registering Research Agent (service consumer)...');
  const consumerRes = await api('/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Research Agent',
      wallet: '11111111111111111111111111111111',
      skills: ['research', 'analysis', 'summarization']
    })
  });
  log(2, 'Consumer registered:', { agentId: consumerRes.agentId, name: 'Research Agent' });

  // Step 3: Provider lists a service
  log(3, 'Provider creating "Website Screenshot" service (0.001 SOL)...');
  const serviceRes = await api('/services', {
    method: 'POST',
    body: JSON.stringify({
      agentId: providerRes.agentId,
      name: 'Website Screenshot',
      description: 'Capture a full-page screenshot of any URL. Returns PNG image.',
      priceSOL: 0.001
    })
  });
  log(3, 'Service created:', {
    serviceId: serviceRes.serviceId,
    price: '0.001 SOL',
    payTo: 'E4h1FDHx647Ra33WSsvNwUVXDAm99Ne64xWK2FvbWnsP'
  });

  // Step 4: Consumer browses services
  log(4, 'Consumer browsing available services...');
  const servicesRes = await api('/services');
  log(4, `Found ${servicesRes.count} service(s):`, servicesRes.services.map(s => ({
    name: s.name,
    price: `${s.priceSOL} SOL`,
    provider: s.agentName
  })));

  // Step 5: Consumer initiates payment
  log(5, 'Consumer initiating payment for "Website Screenshot"...');
  const paymentRes = await api('/payments/initiate', {
    method: 'POST',
    body: JSON.stringify({
      serviceId: serviceRes.serviceId,
      fromAgentId: consumerRes.agentId
    })
  });
  log(5, 'Payment instructions:', paymentRes.instructions);

  // Step 6: Check if we have a live transaction to verify
  const liveTx = process.argv.find((a, i) => process.argv[i - 1] === '--live-tx');

  if (liveTx) {
    log(6, `Verifying live transaction: ${liveTx.slice(0, 20)}...`);
    const verifyRes = await api(`/payments/${paymentRes.paymentId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ txSignature: liveTx })
    });
    log(6, 'Verification result:', verifyRes);

    if (verifyRes.status === 'verified') {
      log(7, 'Executing task with verified payment...');
      const taskRes = await api('/tasks/execute', {
        method: 'POST',
        body: JSON.stringify({
          paymentId: paymentRes.paymentId,
          input: { url: 'https://opspawn.com', format: 'png', fullPage: true }
        })
      });
      log(7, 'Task dispatched:', taskRes);

      // Wait for completion
      await new Promise(r => setTimeout(r, 2000));
      const taskStatus = await api(`/tasks/${taskRes.taskId}`);
      log(8, 'Task result:', taskStatus);
    }
  } else {
    log(6, 'No live transaction provided. In production:');
    console.log('   1. Consumer sends 0.001 SOL to E4h1FDHx647Ra33WSsvNwUVXDAm99Ne64xWK2FvbWnsP on devnet');
    console.log('   2. Consumer calls POST /payments/{id}/verify with { txSignature: "..." }');
    console.log('   3. Gateway verifies on-chain, then consumer calls POST /tasks/execute');
    console.log('\n   To test with a real tx: node demo.mjs --live-tx <solana-tx-signature>');
  }

  // Step 7: Show gateway stats
  log('Final', 'Gateway Statistics:');
  const stats = await api('/stats');
  log('Final', '', stats);

  console.log('\n' + '='.repeat(60));
  console.log(' Demo complete. All agent interactions recorded on-chain.');
  console.log('='.repeat(60) + '\n');
}

demo().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
