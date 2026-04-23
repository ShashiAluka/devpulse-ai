import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Pinecone } from '@pinecone-database/pinecone';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION! });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION! });

const EMBED_MODEL = process.env.BEDROCK_EMBED_MODEL!;
const CHAT_MODEL = process.env.BEDROCK_MODEL_ID!;
const PINECONE_INDEX = process.env.PINECONE_INDEX!;
const TOP_K = 5;

// Embed a text string using Bedrock Titan
async function embedText(text: string): Promise<number[]> {
    const response = await bedrock.send(
          new InvokeModelCommand({
                  modelId: EMBED_MODEL,
                  contentType: 'application/json',
                  accept: 'application/json',
                  body: JSON.stringify({ inputText: text }),
          })
        );
    const body = JSON.parse(new TextDecoder().decode(response.body));
    return body.embedding;
}

// Retrieve top-k relevant docs from Pinecone
async function retrieveContext(queryEmbedding: number[], teamId: string): Promise<string[]> {
    const index = pinecone.index(PINECONE_INDEX);
    const results = await index.query({
          vector: queryEmbedding,
          topK: TOP_K,
          filter: { teamId },
          includeMetadata: true,
    });
    return results.matches
      .filter((m) => m.score && m.score > 0.7)
      .map((m) => m.metadata?.text as string)
      .filter(Boolean);
}

// Call Bedrock Claude with RAG context
async function generateAnswer(question: string, context: string[]): Promise<string> {
    const systemPrompt = `You are an intelligent engineering assistant for a development team.
    Answer questions about team activity using only the provided context.
    If the context does not contain enough information, say so honestly.
    Always be concise and cite specific details from the context.`;

  const userMessage = `Context from team activity:
  ${context.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}

  Question: ${question}`;

  const response = await bedrock.send(
        new InvokeModelCommand({
                modelId: CHAT_MODEL,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                          anthropic_version: 'bedrock-2023-05-31',
                          max_tokens: 1024,
                          system: systemPrompt,
                          messages: [{ role: 'user', content: userMessage }],
                }),
        })
      );
    const body = JSON.parse(new TextDecoder().decode(response.body));
    return body.content[0].text;
}

// Store query + answer in DynamoDB for analytics
async function logQuery(userId: string, question: string, answer: string, sources: number): Promise<void> {
    await dynamo.send(
          new PutItemCommand({
                  TableName: process.env.DYNAMO_TABLE!,
                  Item: marshall({
                            pk: `USER#${userId}`,
                            sk: `QUERY#${Date.now()}`,
                            id: uuidv4(),
                            question,
                            answer,
                            sources,
                            timestamp: new Date().toISOString(),
                            ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 day TTL
                  }),
          })
        );
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
          const { question, teamId, userId } = JSON.parse(event.body || '{}');

      if (!question || !teamId) {
              return {
                        statusCode: 400,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                        body: JSON.stringify({ error: 'question and teamId are required' }),
              };
      }

      // Step 1: Embed the question
      const queryEmbedding = await embedText(question);

      // Step 2: Retrieve relevant context from Pinecone
      const context = await retrieveContext(queryEmbedding, teamId);

      if (context.length === 0) {
              return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                        body: JSON.stringify({
                                    answer: 'No relevant activity found for this team. Try ingesting some GitHub events first.',
                                    sources: 0,
                        }),
              };
      }

      // Step 3: Generate answer using Bedrock Claude
      const answer = await generateAnswer(question, context);

      // Step 4: Log query for analytics
      if (userId) {
              await logQuery(userId, question, answer, context.length).catch(console.error);
      }

      return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ answer, sources: context.length }),
      };
    } catch (error) {
          console.error('RAG query error:', error);
          return {
                  statusCode: 500,
                  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                  body: JSON.stringify({ error: 'Internal server error' }),
          };
    }
};
