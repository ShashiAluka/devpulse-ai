import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Pinecone } from '@pinecone-database/pinecone';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION! });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

const EMBED_MODEL = process.env.BEDROCK_EMBED_MODEL!;
const PINECONE_INDEX = process.env.PINECONE_INDEX!;
const CHUNK_SIZE = 500;

// Generate embedding for text using Bedrock Titan
async function embedText(text: string): Promise<number[]> {
  const response = await bedrock.send(
      new InvokeModelCommand({
            modelId: EMBED_MODEL,
                  contentType: 'application/json',
                        accept: 'application/json',
                              body: JSON.stringify({ inputText: text.substring(0, 8192) }),
                                  })
                                    );
                                      const body = JSON.parse(new TextDecoder().decode(response.body));
                                        return body.embedding;
                                        }

                                        // Chunk long text into overlapping segments for better retrieval
                                        function chunkText(text: string, size: number = CHUNK_SIZE): string[] {
                                          if (text.length <= size) return [text];
                                            const chunks: string[] = [];
                                              const overlap = Math.floor(size * 0.1);
                                                for (let i = 0; i < text.length; i += size - overlap) {
                                                    chunks.push(text.slice(i, i + size));
                                                        if (i + size >= text.length) break;
                                                          }
                                                            return chunks;
                                                            }

                                                            // Process a single SQS record (one activity event)
                                                            async function processRecord(record: SQSRecord): Promise<void> {
                                                              const body = JSON.parse(record.body);
                                                                // EventBridge wraps payload in detail field
                                                                  const activity = body.detail || body;

                                                                    if (!activity?.text || !activity?.teamId) {
                                                                        console.warn('Skipping record with missing text or teamId:', activity?.id);
                                                                            return;
                                                                              }

                                                                                const index = pinecone.index(PINECONE_INDEX);
                                                                                  const chunks = chunkText(activity.text);

                                                                                    const vectors = await Promise.all(
                                                                                        chunks.map(async (chunk, i) => {
                                                                                              const embedding = await embedText(chunk);
                                                                                                    return {
                                                                                                            id: `${activity.id}-chunk-${i}`,
                                                                                                                    values: embedding,
                                                                                                                            metadata: {
                                                                                                                                      activityId: activity.id,
                                                                                                                                                teamId: activity.teamId,
                                                                                                                                                          type: activity.type,
                                                                                                                                                                    actor: activity.actor || '',
                                                                                                                                                                              repo: activity.repo || '',
                                                                                                                                                                                        timestamp: activity.timestamp,
                                                                                                                                                                                                  text: chunk,
                                                                                                                                                                                                            chunkIndex: i,
                                                                                                                                                                                                                    },
                                                                                                                                                                                                                          };
                                                                                                                                                                                                                              })
                                                                                                                                                                                                                                );
                                                                                                                                                                                                                                
                                                                                                                                                                                                                                  // Upsert vectors in batches of 100
                                                                                                                                                                                                                                    const batchSize = 100;
                                                                                                                                                                                                                                      for (let i = 0; i < vectors.length; i += batchSize) {
                                                                                                                                                                                                                                          await index.upsert(vectors.slice(i, i + batchSize));
                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                            
                                                                                                                                                                                                                                              console.log(`Embedded activity ${activity.id} into ${vectors.length} vector(s)`);
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                              
                                                                                                                                                                                                                                              export const handler = async (event: SQSEvent): Promise<void> => {
                                                                                                                                                                                                                                                const results = await Promise.allSettled(
                                                                                                                                                                                                                                                    event.Records.map((record) => processRecord(record))
                                                                                                                                                                                                                                                      );
                                                                                                                                                                                                                                                      
                                                                                                                                                                                                                                                        const failures = results.filter((r) => r.status === 'rejected');
                                                                                                                                                                                                                                                          if (failures.length > 0) {
                                                                                                                                                                                                                                                              failures.forEach((f) => console.error('Embedding failed:', (f as PromiseRejectedResult).reason));
                                                                                                                                                                                                                                                                  // Partial batch failure — rethrow to trigger DLQ for failed messages
                                                                                                                                                                                                                                                                      throw new Error(`${failures.length}/${results.length} records failed to embed`);
                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                        
                                                                                                                                                                                                                                                                          console.log(`Successfully embedded ${results.length} activities`);
                                                                                                                                                                                                                                                                          };
