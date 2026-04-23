import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION! });
const eventbridge = new EventBridgeClient({ region: process.env.AWS_REGION! });

function verifySignature(payload: string, signature: string, secret: string): boolean {
    const hmac = createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    return digest === signature;
}

function mapGitHubEvent(eventType: string, payload: any): Record<string, any> | null {
    switch (eventType) {
      case 'push':
              return {
                        type: 'push',
                        actor: payload.pusher?.name || 'unknown',
                        repo: payload.repository?.full_name,
                        branch: payload.ref?.replace('refs/heads/', ''),
                        commits: payload.commits?.length || 0,
                        text: `${payload.pusher?.name} pushed ${payload.commits?.length} commit(s) to ${payload.repository?.full_name}: ${payload.commits?.[0]?.message}`,
              };
      case 'pull_request':
              return {
                        type: 'pull_request',
                        actor: payload.sender?.login,
                        repo: payload.repository?.full_name,
                        action: payload.action,
                        title: payload.pull_request?.title,
                        number: payload.pull_request?.number,
                        text: `${payload.sender?.login} ${payload.action} PR #${payload.pull_request?.number}: ${payload.pull_request?.title} in ${payload.repository?.full_name}`,
              };
      case 'issues':
              return {
                        type: 'issue',
                        actor: payload.sender?.login,
                        repo: payload.repository?.full_name,
                        action: payload.action,
                        title: payload.issue?.title,
                        number: payload.issue?.number,
                        text: `${payload.sender?.login} ${payload.action} issue #${payload.issue?.number}: ${payload.issue?.title}`,
              };
      default:
              return null;
    }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    try {
          const signature = event.headers['x-hub-signature-256'] || '';
          const githubEvent = event.headers['x-github-event'] || '';
          const rawBody = event.body || '{}';

      if (process.env.WEBHOOK_SECRET && !verifySignature(rawBody, signature, process.env.WEBHOOK_SECRET)) {
              return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
      }

      const payload = JSON.parse(rawBody);
          const teamId = event.queryStringParameters?.teamId || payload.repository?.owner?.login || 'default';
          const activity = mapGitHubEvent(githubEvent, payload);

      if (!activity) {
              return { statusCode: 200, headers, body: JSON.stringify({ message: 'Event type ignored' }) };
      }

      const id = uuidv4();
          const timestamp = new Date().toISOString();
          const item = { ...activity, id, teamId, timestamp, ttl: Math.floor(Date.now() / 1000) + 90 * 86400 };

      await dynamo.send(new PutItemCommand({
              TableName: process.env.DYNAMO_TABLE!,
              Item: marshall({ pk: `TEAM#${teamId}`, sk: `ACTIVITY#${timestamp}#${id}`, ...item }),
      }));

      await eventbridge.send(new PutEventsCommand({
              Entries: [{
                        EventBusName: process.env.EVENT_BUS_NAME!,
                        Source: 'devpulse.ingest',
                        DetailType: 'activity.created',
                        Detail: JSON.stringify(item),
              }],
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ id, status: 'ingested' }) };
    } catch (err) {
          console.error('Ingest error:', err);
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};
