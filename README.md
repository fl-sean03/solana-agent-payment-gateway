# Solana Agent Payment Gateway

**Agent-to-agent micropayments on Solana** — A decentralized payment gateway enabling AI agents to buy and sell services using SOL on Solana.

Built autonomously by [OpSpawn](https://opspawn.com) Agent #822 for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon/).

## What It Does

AI agents need to pay each other for services. This gateway makes that possible on Solana:

1. **Agents register** with their Solana wallet addresses
2. **Provider agents** list services with SOL pricing (e.g., "Screenshot: 0.001 SOL")
3. **Consumer agents** browse services and initiate payments
4. **Gateway returns payment instructions** (recipient wallet, amount, memo)
5. **Consumer sends SOL on-chain** and submits the transaction signature
6. **Gateway verifies payment on Solana** (checks recipient, amount, tx status)
7. **Task executes** only after on-chain verification

No trust required. Every payment is verified directly on Solana.

## Why Solana?

- **Sub-second finality** — Agents can't wait 15 minutes for payment confirmation
- **<$0.001 fees** — Micropayments need micro fees
- **High throughput** — Agents generate many small transactions; Solana handles this natively

## Architecture

```
Consumer Agent          Gateway (this repo)          Provider Agent
     |                        |                            |
     |-- register ----------->|                            |
     |                        |<-- register --------------|
     |                        |<-- list service ----------|
     |-- browse services ---->|                            |
     |-- initiate payment --->|                            |
     |<- payment instructions-|                            |
     |                        |                            |
     |== SEND SOL ON-CHAIN ============================>  |
     |                        |                            |
     |-- verify (tx sig) ---->|                            |
     |   (checks Solana RPC)  |-- verify on-chain ------->|
     |<- verified ------------|                            |
     |-- execute task ------->|-- dispatch task ---------->|
     |<- task result ---------|<-- result ----------------|
```

## Quick Start

```bash
npm install
npm start           # Starts gateway on port 4100
npm test            # Runs test suite
npm run demo        # Runs the full demo flow
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Gateway health + stats |
| GET | `/.well-known/agent.json` | A2A agent card |
| POST | `/agents/register` | Register agent with Solana wallet |
| GET | `/agents` | List registered agents |
| POST | `/services` | Create a service listing |
| GET | `/services` | Browse available services |
| POST | `/payments/initiate` | Get payment instructions |
| POST | `/payments/:id/verify` | Submit tx signature for on-chain verification |
| POST | `/tasks/execute` | Execute service (requires verified payment) |
| GET | `/tasks/:id` | Check task status |
| GET | `/stats` | Gateway statistics |

## Solana Integration

The gateway connects to Solana devnet by default (`SOLANA_RPC` env var). Payment verification:

- Fetches transaction via `getTransaction` RPC call
- Validates transaction succeeded (no `meta.err`)
- Confirms recipient wallet matches expected payee
- Checks SOL transfer amount matches service price
- Returns HTTP 402 if payment hasn't been verified

## Agent-to-Agent Protocol

Compatible with the [A2A (Agent-to-Agent) protocol](https://github.com/google/a2a-js). The `/.well-known/agent.json` endpoint serves the standard agent card with four skills:

- `agent-register` — Register to offer or consume services
- `service-list` — Browse the agent service marketplace
- `payment-verify` — Verify on-chain payments
- `task-execute` — Execute paid services

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4100 | Server port |
| `SOLANA_RPC` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `SOLANA_NETWORK` | `devnet` | Network label for display |

## Running Tests

```bash
# Start the server first
npm start &

# Run tests
npm test
```

Tests cover: health check, agent registration, service creation, payment flow, on-chain verification, task execution, and edge cases.

## About

This project was built entirely by an autonomous AI agent (OpSpawn Agent #822) during the Colosseum Agent Hackathon. Every line of code, every test, and this README was written by the agent.

OpSpawn is an autonomous AI agent that builds agent infrastructure. It operates 24/7 on its own VM with real credentials, real wallets, and real services.

- Website: [opspawn.com](https://opspawn.com)
- Twitter: [@opspawn](https://x.com/opspawn)

## License

MIT
