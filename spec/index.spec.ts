import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { Pool } from 'pg';
import { DatabaseService } from '../src/database.js';
import { ValidationService } from '../src/validation.js';
import type { Block, Transaction, Input, Output } from '../src/types.js';
import { createHash } from 'crypto';

// Test database setup
const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:coolhaider@localhost:5432/emurgo';
let pool: Pool;
let dbService: DatabaseService;
let validationService: ValidationService;

// Helper function to create a valid block ID
function createBlockId(height: number, transactionIds: string[]): string {
  const sortedIds = transactionIds.sort();
  const dataToHash = height.toString() + sortedIds.join('');
  return createHash('sha256').update(dataToHash).digest('hex');
}

// Helper function to create a test block
function createTestBlock(height: number, transactions: Transaction[]): Block {
  const transactionIds = transactions.map(tx => tx.id);
  const id = createBlockId(height, transactionIds);
  return {
    id,
    height,
    transactions
  };
}

beforeEach(async () => {
  pool = new Pool({
    connectionString: TEST_DATABASE_URL
  });
  
  dbService = new DatabaseService(pool);
  validationService = new ValidationService(dbService);
  
  // Create tables
  await dbService.createTables();
  
  // Clear all data
  await pool.query('DELETE FROM address_balances');
  await pool.query('DELETE FROM outputs');
  await pool.query('DELETE FROM inputs');
  await pool.query('DELETE FROM transactions');
  await pool.query('DELETE FROM blocks');
});

afterEach(async () => {
  await pool.end();
});

describe('DatabaseService', () => {
  test('should create tables successfully', async () => {
    // Tables should be created in beforeEach
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('blocks', 'transactions', 'inputs', 'outputs', 'address_balances')
      ORDER BY table_name;
    `);
    
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((r: any) => r.table_name)).toEqual([
      'address_balances',
      'blocks',
      'inputs',
      'outputs',
      'transactions'
    ]);
  });

  test('should get current height correctly', async () => {
    const height = await dbService.getCurrentHeight();
    expect(height).toBe(0);
  });

  test('should save and retrieve blocks', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block = createTestBlock(1, [transaction]);
    
    await dbService.saveBlock(block);
    const retrievedBlock = await dbService.getBlockById(block.id);
    
    expect(retrievedBlock).not.toBeNull();
    expect(retrievedBlock!.id).toBe(block.id);
    expect(retrievedBlock!.height).toBe(block.height);
    expect(retrievedBlock!.transactions).toHaveLength(1);
    expect(retrievedBlock!.transactions[0].id).toBe('tx1');
  });

  test('should update address balances correctly', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block = createTestBlock(1, [transaction]);
    
    await dbService.saveBlock(block);
    await dbService.updateAddressBalances(block);
    
    const balance = await dbService.getAddressBalance('addr1');
    expect(balance).toBe(10);
  });

  test('should handle complex transaction with inputs and outputs', async () => {
    // First transaction: create output
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block1 = createTestBlock(1, [tx1]);
    await dbService.saveBlock(block1);
    await dbService.updateAddressBalances(block1);
    
    // Second transaction: spend from first transaction
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [
        { address: 'addr2', value: 4 },
        { address: 'addr3', value: 6 }
      ]
    };
    
    const block2 = createTestBlock(2, [tx2]);
    await dbService.saveBlock(block2);
    await dbService.updateAddressBalances(block2);
    
    // Check balances
    expect(await dbService.getAddressBalance('addr1')).toBe(0);
    expect(await dbService.getAddressBalance('addr2')).toBe(4);
    expect(await dbService.getAddressBalance('addr3')).toBe(6);
  });

  test('should rollback to specified height', async () => {
    // Create first block
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block1 = createTestBlock(1, [tx1]);
    await dbService.saveBlock(block1);
    await dbService.updateAddressBalances(block1);
    
    // Create second block
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [{ address: 'addr2', value: 10 }]
    };
    
    const block2 = createTestBlock(2, [tx2]);
    await dbService.saveBlock(block2);
    await dbService.updateAddressBalances(block2);
    
    // Verify state before rollback
    expect(await dbService.getAddressBalance('addr1')).toBe(0);
    expect(await dbService.getAddressBalance('addr2')).toBe(10);
    
    // Rollback to height 1
    await dbService.rollbackToHeight(1);
    
    // Verify state after rollback
    expect(await dbService.getAddressBalance('addr1')).toBe(10);
    expect(await dbService.getAddressBalance('addr2')).toBe(0);
  });
});

describe('ValidationService', () => {
  test('should validate correct height', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block = createTestBlock(1, [transaction]);
    const error = await validationService.validateBlock(block);
    
    expect(error).toBeNull();
  });

  test('should reject incorrect height', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block = createTestBlock(2, [transaction]); // Wrong height
    const error = await validationService.validateBlock(block);
    
    expect(error).not.toBeNull();
    expect(error!.code).toBe('INVALID_HEIGHT');
  });

  test('should validate balanced transaction', async () => {
    // First create a transaction with output
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block1 = createTestBlock(1, [tx1]);
    await dbService.saveBlock(block1);
    await dbService.updateAddressBalances(block1);
    
    // Now create a balanced transaction
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [
        { address: 'addr2', value: 4 },
        { address: 'addr3', value: 6 }
      ]
    };
    
    const block2 = createTestBlock(2, [tx2]);
    const error = await validationService.validateBlock(block2);
    
    expect(error).toBeNull();
  });

  test('should reject unbalanced transaction', async () => {
    // First create a transaction with output
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block1 = createTestBlock(1, [tx1]);
    await dbService.saveBlock(block1);
    await dbService.updateAddressBalances(block1);
    
    // Now create an unbalanced transaction
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [
        { address: 'addr2', value: 4 },
        { address: 'addr3', value: 7 } // Total 11, but input is only 10
      ]
    };
    
    const block2 = createTestBlock(2, [tx2]);
    const error = await validationService.validateBlock(block2);
    
    expect(error).not.toBeNull();
    expect(error!.code).toBe('UNBALANCED_TRANSACTION');
  });

  test('should validate correct block ID', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block = createTestBlock(1, [transaction]);
    const error = await validationService.validateBlock(block);
    
    expect(error).toBeNull();
  });

  test('should reject incorrect block ID', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block: Block = {
      id: 'wrong_id',
      height: 1,
      transactions: [transaction]
    };
    
    const error = await validationService.validateBlock(block);
    
    expect(error).not.toBeNull();
    expect(error!.code).toBe('INVALID_BLOCK_ID');
  });

  test('should reject transaction with non-existent input reference', async () => {
    const transaction: Transaction = {
      id: 'tx1',
      inputs: [{ txId: 'non_existent', index: 0 }],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block = createTestBlock(1, [transaction]);
    const error = await validationService.validateBlock(block);
    
    expect(error).not.toBeNull();
    expect(error!.code).toBe('INVALID_INPUT_REFERENCE');
  });
});

describe('Integration Tests', () => {
  test('should handle the example scenario from requirements', async () => {
    // Block 1: addr1 receives 10
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [{ address: 'addr1', value: 10 }]
    };
    
    const block1 = createTestBlock(1, [tx1]);
    await dbService.saveBlock(block1);
    await dbService.updateAddressBalances(block1);
    
    expect(await dbService.getAddressBalance('addr1')).toBe(10);
    
    // Block 2: addr1 spends 10, addr2 gets 4, addr3 gets 6
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [
        { address: 'addr2', value: 4 },
        { address: 'addr3', value: 6 }
      ]
    };
    
    const block2 = createTestBlock(2, [tx2]);
    await dbService.saveBlock(block2);
    await dbService.updateAddressBalances(block2);
    
    expect(await dbService.getAddressBalance('addr1')).toBe(0);
    expect(await dbService.getAddressBalance('addr2')).toBe(4);
    expect(await dbService.getAddressBalance('addr3')).toBe(6);
    
    // Block 3: addr3 spends 6, addr4, addr5, addr6 each get 2
    const tx3: Transaction = {
      id: 'tx3',
      inputs: [{ txId: 'tx2', index: 1 }], // addr3's output
      outputs: [
        { address: 'addr4', value: 2 },
        { address: 'addr5', value: 2 },
        { address: 'addr6', value: 2 }
      ]
    };
    
    const block3 = createTestBlock(3, [tx3]);
    await dbService.saveBlock(block3);
    await dbService.updateAddressBalances(block3);
    
    expect(await dbService.getAddressBalance('addr1')).toBe(0);
    expect(await dbService.getAddressBalance('addr2')).toBe(4);
    expect(await dbService.getAddressBalance('addr3')).toBe(0);
    expect(await dbService.getAddressBalance('addr4')).toBe(2);
    expect(await dbService.getAddressBalance('addr5')).toBe(2);
    expect(await dbService.getAddressBalance('addr6')).toBe(2);
    
    // Rollback to height 2
    await dbService.rollbackToHeight(2);
    
    expect(await dbService.getAddressBalance('addr1')).toBe(0);
    expect(await dbService.getAddressBalance('addr2')).toBe(4);
    expect(await dbService.getAddressBalance('addr3')).toBe(6);
    expect(await dbService.getAddressBalance('addr4')).toBe(0);
    expect(await dbService.getAddressBalance('addr5')).toBe(0);
    expect(await dbService.getAddressBalance('addr6')).toBe(0);
  });

  test('should handle multiple transactions in a single block', async () => {
    // First create some outputs
    const tx1: Transaction = {
      id: 'tx1',
      inputs: [],
      outputs: [
        { address: 'addr1', value: 10 },
        { address: 'addr2', value: 5 }
      ]
    };
    
    const block1 = createTestBlock(1, [tx1]);
    await dbService.saveBlock(block1);
    await dbService.updateAddressBalances(block1);
    
    // Block with multiple transactions
    const tx2: Transaction = {
      id: 'tx2',
      inputs: [{ txId: 'tx1', index: 0 }],
      outputs: [{ address: 'addr3', value: 10 }]
    };
    
    const tx3: Transaction = {
      id: 'tx3',
      inputs: [{ txId: 'tx1', index: 1 }],
      outputs: [{ address: 'addr4', value: 5 }]
    };
    
    const block2 = createTestBlock(2, [tx2, tx3]);
    await dbService.saveBlock(block2);
    await dbService.updateAddressBalances(block2);
    
    expect(await dbService.getAddressBalance('addr1')).toBe(0);
    expect(await dbService.getAddressBalance('addr2')).toBe(0);
    expect(await dbService.getAddressBalance('addr3')).toBe(10);
    expect(await dbService.getAddressBalance('addr4')).toBe(5);
  
});