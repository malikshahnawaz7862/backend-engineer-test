import Fastify from 'fastify';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { DatabaseService } from './database.js';
import { ValidationService } from './validation.js';
import type { Block } from './types.js';

// Load environment variables
config();

const fastify = Fastify({ logger: true });

let dbService: DatabaseService;
let validationService: ValidationService;

// Health check endpoint
fastify.get('/', async (request: any, reply: any) => {
  return { status: 'ok', message: 'Blockchain Indexer API' };
});

// POST /blocks endpoint
fastify.post('/blocks', async (request: any, reply: any) => {
  try {
    const block = request.body as Block;
    
    // Validate the block
    const validationError = await validationService.validateBlock(block);
    if (validationError) {
      return reply.status(400).send({
        error: validationError.message,
        code: validationError.code
      });
    }

    // Save the block and update balances
    await dbService.saveBlock(block);
    await dbService.updateAddressBalances(block);

    return reply.status(200).send({
      message: 'Block added successfully',
      blockId: block.id,
      height: block.height
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /balance/:address endpoint
fastify.get('/balance/:address', async (request: any, reply: any) => {
  try {
    const { address } = request.params as { address: string };
    
    if (!address) {
      return reply.status(400).send({
        error: 'Address parameter is required'
      });
    }

    const balance = await dbService.getAddressBalance(address);
    
    return reply.status(200).send({
      address,
      balance
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /rollback?height=number endpoint
fastify.post('/rollback', { 
  schema: {
    querystring: {
      type: 'object',
      properties: {
        height: { type: 'string' }
      },
      required: ['height']
    }
  }
}, async (request: any, reply: any) => {
  try {
    const { height } = request.query as { height: string };
    
    if (!height) {
      return reply.status(400).send({
        error: 'Height query parameter is required'
      });
    }

    const targetHeight = parseInt(height);
    if (isNaN(targetHeight) || targetHeight < 0) {
      return reply.status(400).send({
        error: 'Height must be a valid non-negative number'
      });
    }

    const currentHeight = await dbService.getCurrentHeight();
    if (targetHeight > currentHeight) {
      return reply.status(400).send({
        error: `Cannot rollback to height ${targetHeight}. Current height is ${currentHeight}`
      });
    }

    if (currentHeight - targetHeight > 2000) {
      return reply.status(400).send({
        error: 'Cannot rollback more than 2000 blocks'
      });
    }

    await dbService.rollbackToHeight(targetHeight);

    return reply.status(200).send({
      message: `Successfully rolled back to height ${targetHeight}`,
      previousHeight: currentHeight,
      newHeight: targetHeight
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Additional endpoint to get current blockchain state
fastify.get('/status', async (request: any, reply: any) => {
  try {
    const currentHeight = await dbService.getCurrentHeight();
    const allBalances = await dbService.getAllAddressBalances();
    
    return reply.status(200).send({
      currentHeight,
      totalAddresses: allBalances.length,
      balances: allBalances
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

async function bootstrap() {
  console.log('Bootstrapping Blockchain Indexer...');
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: databaseUrl
  });

  // Initialize services
  dbService = new DatabaseService(pool);
  validationService = new ValidationService(dbService);

  // Create database tables
  await dbService.createTables();
  
  console.log('Database tables created successfully');
  console.log('Blockchain Indexer is ready!');
}

try {
  await bootstrap();
  await fastify.listen({
    port: 3000,
    host: '0.0.0.0'
  });
  console.log('Server is running on http://0.0.0.0:3000');
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}