import { createHash } from 'crypto';
import type { Block, ValidationError } from './types.js';
import { DatabaseService } from './database.js';

export class ValidationService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async validateBlock(block: Block): Promise<ValidationError | null> {
    // Validate height
    const heightError = await this.validateHeight(block.height);
    if (heightError) {
      return heightError;
    }

    // Validate input/output balance
    const balanceError = await this.validateInputOutputBalance(block);
    if (balanceError) {
      return balanceError;
    }

    // Validate block ID
    const idError = this.validateBlockId(block);
    if (idError) {
      return idError;
    }

    return null;
  }

  private async validateHeight(height: number): Promise<ValidationError | null> {
    const currentHeight = await this.db.getCurrentHeight();
    
    if (height !== currentHeight + 1) {
      return {
        message: `Invalid height. Expected ${currentHeight + 1}, got ${height}`,
        code: 'INVALID_HEIGHT'
      };
    }

    return null;
  }

  private async validateInputOutputBalance(block: Block): Promise<ValidationError | null> {
    for (const transaction of block.transactions) {
      let totalInputValue = 0;
      let totalOutputValue = 0;

      // Calculate total input value
      for (const input of transaction.inputs) {
        const outputValue = await this.db.getOutputValue(input.txId, input.index);
        if (outputValue === null) {
          return {
            message: `Input reference not found: transaction ${input.txId}, index ${input.index}`,
            code: 'INVALID_INPUT_REFERENCE'
          };
        }
        totalInputValue += outputValue;
      }

      // Calculate total output value
      for (const output of transaction.outputs) {
        totalOutputValue += output.value;
      }

      // Validate balance
      // Allow genesis transactions (no inputs but has outputs) or balanced transactions
      if (transaction.inputs.length > 0 && Math.abs(totalInputValue - totalOutputValue) > 0.000001) {
        return {
          message: `Transaction ${transaction.id} has unbalanced inputs and outputs. Inputs: ${totalInputValue}, Outputs: ${totalOutputValue}`,
          code: 'UNBALANCED_TRANSACTION'
        };
      }
    }

    return null;
  }

  private validateBlockId(block: Block): ValidationError | null {
    // Create the expected block ID: sha256(height + transaction1.id + transaction2.id + ... + transactionN.id)
    const transactionIds = block.transactions.map(tx => tx.id).sort(); // Sort for consistency
    const dataToHash = block.height.toString() + transactionIds.join('');
    const expectedId = createHash('sha256').update(dataToHash).digest('hex');

    if (block.id !== expectedId) {
      return {
        message: `Invalid block ID. Expected ${expectedId}, got ${block.id}`,
        code: 'INVALID_BLOCK_ID'
      };
    }

    return null;
  }
}
