type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  channelId?: string;
  priority?: 'default' | 'high';
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<{
  invalidTokens: string[];
  errors: string[];
}> {
  const invalidTokens: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const json = (await response.json()) as { data?: ExpoPushTicket[]; errors?: Array<{ message?: string }> };
      if (!response.ok) {
        errors.push(`Expo push error ${response.status}`);
        continue;
      }
      if (Array.isArray(json?.data)) {
        json.data.forEach((ticket, idx) => {
          if (ticket.status === 'error') {
            const token = chunk[idx]?.to;
            if (ticket.details?.error === 'DeviceNotRegistered' && token) {
              invalidTokens.push(token);
            } else if (ticket.message) {
              errors.push(ticket.message);
            }
          }
        });
      }
      if (Array.isArray(json?.errors)) {
        json.errors.forEach((err) => {
          if (err?.message) errors.push(err.message);
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { invalidTokens, errors };
}

export type { ExpoPushMessage };
