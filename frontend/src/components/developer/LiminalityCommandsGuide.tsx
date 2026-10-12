import { Box, Chip, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

type Example = {
  say: string;
  does: string;
};

function Section({
  title,
  body,
  examples,
}: {
  title: string;
  body: string;
  examples?: Example[];
}) {
  const theme = useTheme();
  const outline =
    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

  return (
    <Paper sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: examples?.length ? 2 : 0 }}>
        {body}
      </Typography>
      {examples?.length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {examples.map((row) => (
            <Box
              key={row.say}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { sm: 'flex-start' },
                gap: 1,
                px: 1.5,
                py: 1.25,
                borderRadius: '12px',
                border: '1px solid',
                borderColor: outline,
              }}
            >
              <Chip
                label={`“${row.say}”`}
                size="small"
                sx={{
                  fontWeight: 600,
                  height: 'auto',
                  py: 0.5,
                  maxWidth: { sm: 280 },
                  '& .MuiChip-label': { whiteSpace: 'normal' },
                }}
              />
              <Typography variant="body2" sx={{ pt: { sm: 0.35 } }}>
                {row.does}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Paper>
  );
}

export default function LiminalityCommandsGuide() {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Liminality is the shop-floor voice agent. Turn it on in Account Settings, then use Chrome
        or Edge on a desktop with the mic allowed. Call her name, wait for the listen cue, and
        talk. Nothing is recorded while she is off.
      </Typography>

      <Section
        title="Wake her up"
        body="Say either name. You get a listen sound, not a spoken hello. Then she listens for 30 seconds. The same sound plays when that window ends. You do not have to say the name again during those 30 seconds."
        examples={[
          { say: 'Liminnality', does: 'Primary wake. Liminality / liminal also work if speech-to-text mangles it.' },
          { say: 'Motherfucker', does: 'Backup wake. Chrome often censors it; mother trucker / mother father still count.' },
        ]}
      />

      <Section
        title="Open a shop screen"
        body="Short navigation. On the kiosk / TV views she stays in the *-view screens. From the office dashboard, “dashboard” opens the office dashboard unless you say dashboard view."
        examples={[
          { say: 'Pipeline', does: 'Opens the shop pipeline.' },
          { say: 'Calendar', does: 'Opens the shop calendar.' },
          { say: 'Customers', does: 'Opens the shop customers view. Contacts works too.' },
          { say: 'Dashboard', does: 'Opens the dashboard (office or shop, depending where you already are).' },
          { say: 'Go to pipeline', does: 'Same as pipeline. Open / take me to / show me also work.' },
        ]}
      />

      <Section
        title="Text a job to someone"
        body="This texts the customer card (name, phones, email, address, gate code, job title) to a mobile on the employee rolodex. It does not send a custom message. If a name is missing, just say the missing piece — do not repeat the whole sentence."
        examples={[
          { say: 'Send Hammer to Jake', does: 'Texts the Hammer customer card to Jake.' },
          { say: 'Send this job to Maria', does: 'Uses the job you are looking at, if she already has that context.' },
          { say: 'Send Skoczulek', does: 'She asks who. Then say the employee name.' },
          { say: 'To Jake', does: 'Fills in the person if she already has the job.' },
          { say: 'The user', does: 'If two Jake matches exist (login vs rolodex contact), pick the login account. “The contact” picks the rolodex card.' },
        ]}
      />

      <Section
        title="Ask about the shop"
        body="Anything that sounds like a question goes to Paarth Help with live tenant data. Keep it to one ask at a time. She answers out loud in a couple of short sentences."
        examples={[
          { say: 'What’s the most recent payment?', does: 'Last customer payments marked received.' },
          { say: 'What’s the most recent deposit?', does: 'Latest customer/job deposit (paid deposit line on a job). Unlinked bank inflows are ignored.' },
          { say: 'Did Hammer make a deposit?', does: 'Looks up that customer or job by name and says yes/no from their deposit record.' },
          { say: 'Who’s coming up?', does: 'Upcoming calendar appointments and jobs.' },
          { say: 'What’s on the calendar this week?', does: 'Same schedule lookup, next several days.' },
          { say: 'What jobs do we have in Dana Point?', does: 'Opens the dashboard map, filters to that city only, zooms in, and highlights each job as she names it.' },
          { say: 'What jobs do we have near Fullerton?', does: 'Same map, 25-mile radius. She names each job while that pin highlights.' },
          { say: 'Show scheduled jobs over twenty thousand', does: 'Same map, filtered by scheduled + amount.' },
          { say: 'Jobs in Dana Point', does: 'Same map tour. You can also filter the map yourself by name, city, stage, scheduled, and amount.' },
          { say: 'Open the Hammer job', does: 'Opens the job card here (does not switch to pipeline) on the Files tab so photos are visible.' },
          { say: 'Materials to order', does: 'Searches job notes and crew notes for supplies / hardware / cabinets.' },
          { say: 'Tell me about the Hammer job', does: 'Looks up that job and opens the card on Files.' },
          { say: 'Find Skoczulek', does: 'Same search as the top-bar search: customers and jobs.' },
          { say: 'Open finance', does: 'Jumps to an in-app page (pipeline, customers, bills, payroll, and the rest of the allowed screens).' },
        ]}
      />

      <Section
        title="Stop listening"
        body="Any of these closes the 60-second window and she goes back to waiting for a wake word."
        examples={[
          { say: 'Stop', does: 'Cancels the current listen window.' },
          { say: 'Never mind', does: 'Same. Cancel, that’s all, goodbye, thanks, and go to sleep also work.' },
        ]}
      />

      <Section
        title="Tips that save you from repeating yourself"
        body="The listen cue means she heard the wake. Speak the command after it. If she got the job but not the person, only say the person. If speech-to-text writes lemon ality, that still counts as her name. Voice replies use ElevenLabs — pick a voice under Account Settings → Liminality."
      />
    </Box>
  );
}
