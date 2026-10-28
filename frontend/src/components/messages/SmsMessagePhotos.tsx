import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import api from '../../utils/axios';

type MediaRef = { index: number };

export default function SmsMessagePhotos({
  messageId,
  media,
}: {
  messageId: string;
  media?: MediaRef[] | null;
}) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const items = Array.isArray(media) ? media : [];
    if (!messageId || !items.length) {
      setUrls([]);
      return undefined;
    }
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: string[] = [];
      for (const item of items) {
        try {
          const response = await api.get(`/twilio/messages/${messageId}/media/${item.index}`, {
            responseType: 'blob',
          });
          const url = URL.createObjectURL(response.data);
          created.push(url);
          next.push(url);
        } catch {
          /* A missing photo should not hide the text. */
        }
      }
      if (cancelled) {
        created.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setUrls(next);
    })();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [messageId, media]);

  if (!urls.length) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 0.5 }}>
      {urls.map((url) => (
        <Box
          key={url}
          component="img"
          src={url}
          alt="Message photo"
          sx={{
            display: 'block',
            maxWidth: 220,
            maxHeight: 220,
            borderRadius: 1.5,
            objectFit: 'cover',
          }}
        />
      ))}
    </Box>
  );
}
