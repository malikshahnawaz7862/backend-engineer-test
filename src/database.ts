import { Pool } from 'pg';
import type { Block, Transaction, AddressBalance } from './types.js';

export class DatabaseService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async createTables(): Promise<void> {
    // Create blocks table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        height INTEGER UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create transactions table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create inputs table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS inputs (
        id SERIAL PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        tx_id TEXT NOT NULL,
        index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create outputs table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS outputs (
        id SERIAL PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        value NUMERIC NOT NULL,
        index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create address_balances table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS address_balances (
        address TEXT PRIMARY KEY,
        balance NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for better performance
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(height);
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_block_id ON transactions(block_id);
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_outputs_address ON outputs(address);
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_inputs_tx_id_index ON inputs(tx_id, index);
    `);
  }

  async getCurrentHeight(): Promise<number> {
    const result = await this.pool.query(`
      SELECT COALESCE(MAX(height), 0) as height FROM blocks;
    `);
    return parseInt(result.rows[0].height);
  }

  async getBlockById(blockId: string): Promise<Block | null> {
    const blockResult = await this.pool.query(`
      SELECT id, height FROM blocks WHERE id = $1;
    `, [blockId]);

    if (blockResult.rows.length === 0) {
      return null;
    }

    const block = blockResult.rows[0];
    
    // Get transactions for this block
    const transactionsResult = await this.pool.query(`
      SELECT id FROM transactions WHERE block_id = $1 ORDER BY created_at;
    `, [blockId]);

    const transactions: Transaction[] = [];
    
    for (const txRow of transactionsResult.rows) {
      const transaction = await this.getTransactionById(txRow.id);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return {
      id: block.id,
      height: block.height,
      transactions
    };
  }

  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    // Get inputs
    const inputsResult = await this.pool.query(`
      SELECT tx_id, index FROM inputs WHERE transaction_id = $1 ORDER BY id;
    `, [transactionId]);

    // Get outputs
    const outputsResult = await this.pool.query(`
      SELECT address, value, index FROM outputs WHERE transaction_id = $1 ORDER BY index;
    `, [transactionId]);

    if (inputsResult.rows.length === 0 && outputsResult.rows.length === 0) {
      return null;
    }

    return {
      id: transactionId,
      inputs: inputsResult.rows.map((row: any) => ({
        txId: row.tx_id,
        index: row.index
      })),
      outputs: outputsResult.rows.map((row: any) => ({
        address: row.address,
        value: parseFloat(row.value)
      }))
    };
  }

  async saveBlock(block: Block): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Insert block
      await client.query(`
        INSERT INTO blocks (id, height) VALUES ($1, $2);
      `, [block.id, block.height]);

      // Insert transactions and their inputs/outputs
      for (const transaction of block.transactions) {
        await client.query(`
          INSERT INTO transactions (id, block_id) VALUES ($1, $2);
        `, [transaction.id, block.id]);

        // Insert inputs
        for (const input of transaction.inputs) {
          await client.query(`
            INSERT INTO inputs (transaction_id, tx_id, index) VALUES ($1, $2, $3);
          `, [transaction.id, input.txId, input.index]);
        }

        // Insert outputs
        for (let i = 0; i < transaction.outputs.length; i++) {
          const output = transaction.outputs[i];
          await client.query(`
            INSERT INTO outputs (transaction_id, address, value, index) VALUES ($1, $2, $3, $4);
          `, [transaction.id, output.address, output.value, i]);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAddressBalances(block: Block): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      for (const transaction of block.transactions) {
        // Process inputs (spend from addresses)
        for (const input of transaction.inputs) {
          const outputResult = await client.query(`
            SELECT address, value FROM outputs 
            WHERE transaction_id = $1 AND index = $2;
          `, [input.txId, input.index]);

          if (outputResult.rows.length > 0) {
            const { address, value } = outputResult.rows[0];
            await client.query(`
              INSERT INTO address_balances (address, balance) 
              VALUES ($1, -$2)
              ON CONFLICT (address) 
              DO UPDATE SET balance = address_balances.balance - $2::NUMERIC, updated_at = CURRENT_TIMESTAMP;
            `, [address, value]);
          }
        }

        // Process outputs (add to addresses)
        for (const output of transaction.outputs) {
          await client.query(`
            INSERT INTO address_balances (address, balance) 
            VALUES ($1, $2)
            ON CONFLICT (address) 
            DO UPDATE SET balance = address_balances.balance + $2::NUMERIC, updated_at = CURRENT_TIMESTAMP;
          `, [output.address, output.value]);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAddressBalance(address: string): Promise<number> {
    const result = await this.pool.query(`
      SELECT balance FROM address_balances WHERE address = $1;
    `, [address]);

    return result.rows.length > 0 ? parseFloat(result.rows[0].balance) : 0;
  }

  async getAllAddressBalances(): Promise<AddressBalance[]> {
    const result = await this.pool.query(`
      SELECT address, balance FROM address_balances ORDER BY address;
    `);

    return result.rows.map((row: any) => ({
      address: row.address,
      balance: parseFloat(row.balance)
    }));
  }

  async rollbackToHeight(targetHeight: number): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Delete all blocks above target height (cascade will handle transactions, inputs, outputs)
      await client.query(`
        DELETE FROM blocks WHERE height > $1;
      `, [targetHeight]);

      // Clear all balances
      await client.query(`
        DELETE FROM address_balances;
      `);

      // Recalculate balances from remaining blocks
      const remainingTransactions = await client.query(`
        SELECT t.id as tx_id
        FROM blocks b
        JOIN transactions t ON b.id = t.block_id
        WHERE b.height <= $1
        ORDER BY b.height, t.id;
      `, [targetHeight]);

      // Process each transaction to rebuild balances
      for (const row of remainingTransactions.rows) {
        const txId = row.tx_id;

        // Get inputs for this transaction
        const inputs = await client.query(`
          SELECT tx_id, index FROM inputs WHERE transaction_id = $1;
        `, [txId]);

        // Process inputs (spend from addresses)
        for (const input of inputs.rows) {
          const outputResult = await client.query(`
            SELECT address, value FROM outputs 
            WHERE transaction_id = $1 AND index = $2;
          `, [input.tx_id, input.index]);

          if (outputResult.rows.length > 0) {
            const { address, value } = outputResult.rows[0];
            await client.query(`
              INSERT INTO address_balances (address, balance)
              VALUES ($1, -$2::NUMERIC)
              ON CONFLICT (address)
              DO UPDATE SET balance = address_balances.balance - $2::NUMERIC, updated_at = CURRENT_TIMESTAMP;
            `, [address, value]);
          }
        }

        // Get outputs for this transaction
        const outputs = await client.query(`
          SELECT address, value FROM outputs WHERE transaction_id = $1;
        `, [txId]);

        // Process outputs (add to addresses)
        for (const output of outputs.rows) {
          await client.query(`
            INSERT INTO address_balances (address, balance)
            VALUES ($1, $2::NUMERIC)
            ON CONFLICT (address)
            DO UPDATE SET balance = address_balances.balance + $2::NUMERIC, updated_at = CURRENT_TIMESTAMP;
          `, [output.address, output.value]);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getOutputValue(txId: string, index: number): Promise<number | null> {
    const result = await this.pool.query(`
      SELECT value FROM outputs 
      WHERE transaction_id = $1 AND index = $2;
    `, [txId, index]);

    return result.rows.length > 0 ? parseFloat(result.rows[0].value) : null;
  }
}
