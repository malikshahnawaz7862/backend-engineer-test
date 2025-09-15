# Blockchain Indexer API

A blockchain indexer that tracks address balances using the UTXO (Unspent Transaction Output) model. This project implements a REST API to process blocks, validate transactions, and maintain address balances.

## Features

- **Block Processing**: Accept and validate blockchain blocks with comprehensive validation
- **Balance Tracking**: Maintain real-time balances for all addresses using UTXO model
- **Rollback Support**: Rollback blockchain state to any previous height (up to 2000 blocks)
- **Transaction Validation**: Validate block height, input/output balance, and block ID integrity
- **Database Persistence**: PostgreSQL database for reliable data storage

## API Endpoints

### POST /blocks
Add a new block to the blockchain indexer.

**Request Body:**
```json
{
  "id": "block_hash",
  "height": 1,
  "transactions": [
    {
      "id": "tx1",
      "inputs": [
        {
          "txId": "previous_tx_id",
          "index": 0
        }
      ],
      "outputs": [
        {
          "address": "addr1",
          "value": 10
        }
      ]
    }
  ]
}
```

**Validations:**
- Block height must be exactly one unit higher than current height
- Sum of input values must equal sum of output values for each transaction
- Block ID must be SHA256 hash of (height + sorted transaction IDs)

### GET /balance/:address
Get the current balance of a specific address.

**Response:**
```json
{
  "address": "addr1",
  "balance": 10
}
```

### POST /rollback?height=number
Rollback the blockchain state to a specified height.

**Query Parameters:**
- `height`: Target height to rollback to (must be ≤ current height and within 2000 blocks)

**Response:**
```json
{
  "message": "Successfully rolled back to height 2",
  "previousHeight": 3,
  "newHeight": 2
}
```

### GET /status
Get current blockchain status and all address balances.

**Response:**
```json
{
  "currentHeight": 3,
  "totalAddresses": 6,
  "balances": [
    { "address": "addr1", "balance": 0 },
    { "address": "addr2", "balance": 4 },
    { "address": "addr3", "balance": 0 },
    { "address": "addr4", "balance": 2 },
    { "address": "addr5", "balance": 2 },
    { "address": "addr6", "balance": 2 }
  ]
}
```

## Setup

### Prerequisites
- Docker and Docker Compose
- Bun (optional, for local development)

### Running with Docker
```bash
docker-compose up -d --build
```

### Running with Bun
```bash
bun install
bun run-docker
```

The API will be available at `http://localhost:3000`

## Database Schema

The application uses PostgreSQL with the following tables:

- **blocks**: Stores block information (id, height, timestamp)
- **transactions**: Stores transaction information (id, block_id)
- **inputs**: Stores transaction inputs (transaction_id, tx_id, index)
- **outputs**: Stores transaction outputs (transaction_id, address, value, index)
- **address_balances**: Stores current balance for each address

## Testing

Run the test suite:
```bash
bun test
```

The tests cover:
- Database operations and schema
- Block validation logic
- Transaction processing
- Rollback functionality
- Integration scenarios matching the requirements example

## Example Usage

Here's the example scenario from the requirements:

1. **Block 1**: addr1 receives 10
```json
{
  "height": 1,
  "transactions": [{
    "id": "tx1",
    "inputs": [],
    "outputs": [{"address": "addr1", "value": 10}]
  }]
}
```

2. **Block 2**: addr1 spends 10, addr2 gets 4, addr3 gets 6
```json
{
  "height": 2,
  "transactions": [{
    "id": "tx2",
    "inputs": [{"txId": "tx1", "index": 0}],
    "outputs": [
      {"address": "addr2", "value": 4},
      {"address": "addr3", "value": 6}
    ]
  }]
}
```

3. **Block 3**: addr3 spends 6, addr4, addr5, addr6 each get 2
```json
{
  "height": 3,
  "transactions": [{
    "id": "tx3",
    "inputs": [{"txId": "tx2", "index": 1}],
    "outputs": [
      {"address": "addr4", "value": 2},
      {"address": "addr5", "value": 2},
      {"address": "addr6", "value": 2}
    ]
  }]
}
```

4. **Rollback to height 2**: Undoes block 3, restoring addr3's balance to 6

## Architecture

The application follows a clean architecture pattern:

- **Types** (`src/types.ts`): TypeScript interfaces for all data structures
- **Database Service** (`src/database.ts`): Handles all database operations
- **Validation Service** (`src/validation.ts`): Implements block and transaction validation
- **API Routes** (`src/index.ts`): Fastify server with REST endpoints
- **Tests** (`spec/`): Comprehensive test suite

## Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Validation errors (invalid height, unbalanced transaction, invalid block ID)
- `500`: Internal server errors

All errors include descriptive messages and error codes for easy debugging.

## Original Challenge Instructions

This challenge is designed to evaluate your skills with data processing and API development. You will be responsible for creating an indexer that will keep track of the balance of each address in a blockchain.

### Understanding the Schema
If you are familiar with the UTXO model, you will recognize the schema above. If you are not, here is a brief explanation:
- each transaction is composed of inputs and outputs;
- each input is a reference to an output of a previous transaction;
- each output means a given address **received** a certain amount of value;
- from the above, it follows that each input **spends** a certain amount of value from its original address;
- in summary, the balance of an address is the sum of all the values it received minus the sum of all the values it spent;

### Further Instructions
- We expect you to handle errors and edge cases. Understanding what these are and how to handle them is part of the challenge;
- We provided you with a setup to run the API and a Postgres database together using Docker, as well as some sample code to test the database connection. You can change this setup to use any other database you'd like;