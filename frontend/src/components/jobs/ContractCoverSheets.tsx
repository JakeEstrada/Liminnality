import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

export const COVER_LOGO = '/scww.png';
export const ZELLE_QR = '/contract-zelle-qr.png?v=3';

export const OWNER_NAME = 'Edward T. Estrada';
export const OWNER_PHONE = '949-498-4397';
export const LICENSE_NUMBER = '# C-6 753246';
export const CSLB_ADDRESS = '9835 Goethe Road';
export const STAINER_REFERRALS = '*Jesus (949)616-2038 | *Carlos Jimenez (714)678-7072';
export const SHOP_ADDRESS_1 = '1030 Calle Sombra, F';
export const SHOP_ADDRESS_2 = 'San Clemente, CA 92673';

export const NOTICE_TEXT =
  'Under the Mechanics’ Lien law, any contractor, subcontractor, laborer, material man or other person who helps to improve your property and is not paid for his labor, services or materials has a right to enforce his claim against your property. Under the law you may protect yourself against such claims by filing, before commencing such work of improvement, an original contract for the work of improvement or a modification thereof, in the office of the county recorder of the county where the property is situated and requiring that a contractor’s payment bond be recorded in such office. Said bond shall be in an amount not less than fifty percent (50%) of the contract price and shall, in addition to any conditions for the performance of the contract, be conditioned for the payment in full of the claims of all persons furnishing labor, services, equipment or materials for the work described in said contract. Owner has a 3 day right of rescission to cancel contract after date of signing.';

export const COVER_PRINT_STORAGE_KEY = 'paarth.contract-cover.print';

export type ContractCoverData = {
  customerName: string;
  street: string;
  cityStateDisplay: string;
  contractDate: string;
  estimateNumber: string;
  totalLabel: string;
  inspectionParagraph: string;
  paymentLines: string[];
  paymentNotes: string[];
};

export const PAGE_SX = {
  width: 816,
  height: 1056,
  mx: 'auto',
  bgcolor: '#fff',
  color: '#000',
  boxSizing: 'border-box',
  fontFamily: 'Arial, Helvetica, sans-serif',
  '& .MuiTypography-root': { color: '#000' },
};

const PAGE_BREAK_AFTER = {
  pageBreakAfter: 'always',
  breakAfter: 'page',
};

function ContractSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ mt: 2.15 }}>
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          mb: 0.55,
        }}
      >
        {number}. {title}
      </Typography>
      {children}
    </Box>
  );
}

export function writeContractCoverPrintData(data: ContractCoverData) {
  const json = JSON.stringify(data);
  sessionStorage.setItem(COVER_PRINT_STORAGE_KEY, json);
  localStorage.setItem(COVER_PRINT_STORAGE_KEY, json);
}

export function readContractCoverPrintData(): ContractCoverData | null {
  const raw = sessionStorage.getItem(COVER_PRINT_STORAGE_KEY) || localStorage.getItem(COVER_PRINT_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ContractCoverData;
  } catch {
    return null;
  }
}

export default function ContractCoverSheets({ data }: { data: ContractCoverData }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
      <Box sx={{ ...PAGE_SX, ...PAGE_BREAK_AFTER, p: '32px' }}>
        <Box
          sx={{
            height: '100%',
            border: '4px solid #000',
            boxSizing: 'border-box',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: '48px',
            py: '40px',
          }}
        >
          <Box sx={{ width: '100%' }}>
            <Typography sx={{ fontWeight: 800, fontSize: 34, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Contract. Packet
            </Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 18, mt: 2.25, letterSpacing: '0.1em' }}>
              CUSTOMER
            </Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 24, mt: 0.85, lineHeight: 1.25 }}>
              {data.customerName}
            </Typography>
            {data.street ? (
              <Typography sx={{ fontWeight: 700, fontSize: 20, mt: 0.25, lineHeight: 1.25 }}>
                {data.street}
              </Typography>
            ) : null}
            {data.cityStateDisplay ? (
              <Typography sx={{ fontWeight: 700, fontSize: 20, mt: 0.25, lineHeight: 1.25 }}>
                {data.cityStateDisplay}
              </Typography>
            ) : null}
          </Box>

          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box
              component="img"
              src={COVER_LOGO}
              alt="San Clemente Woodworking"
              sx={{ width: 156, height: 156, objectFit: 'contain', display: 'block' }}
            />
            <Box
              sx={{
                mt: 2.5,
                border: '1.5px solid #000',
                px: 4,
                py: 1.25,
                minWidth: 300,
                textAlign: 'center',
              }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: 16, textDecoration: 'underline' }}>
                San Clemente Woodworking
              </Typography>
              <Typography sx={{ fontSize: 14.5, mt: 0.4 }}>{SHOP_ADDRESS_1}</Typography>
              <Typography sx={{ fontSize: 14.5 }}>{SHOP_ADDRESS_2}</Typography>
            </Box>
          </Box>

          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography sx={{ fontStyle: 'italic', fontSize: 14, maxWidth: 460, lineHeight: 1.45 }}>
              We appreciate the opportunity to work with you and look forward to completing your project.
            </Typography>
            <Typography sx={{ fontStyle: 'italic', fontWeight: 600, fontSize: 13.5, mt: 2.25 }}>
              Stainer Referrals:
            </Typography>
            <Typography sx={{ fontSize: 13, mt: 0.3, maxWidth: 480 }}>
              {STAINER_REFERRALS}
            </Typography>
            <Box
              component="img"
              src={ZELLE_QR}
              alt="Pay with Zelle"
              sx={{ width: 240, height: 'auto', display: 'block', mt: 2 }}
            />
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          ...PAGE_SX,
          px: '56px',
          py: '44px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: 20, textAlign: 'center', letterSpacing: '0.06em' }}>
          Contract
        </Typography>

        <ContractSection number="1" title="Agreement">
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            This agreement is made and entered into on {data.contractDate}, by and between owner or manager{' '}
            {OWNER_NAME}, phone {OWNER_PHONE}. San Clemente Woodworking proposes to complete the following as
            per attached Estimate #{data.estimateNumber || '______'} with owner’s signature, for a total of{' '}
            {data.totalLabel}.
          </Typography>
        </ContractSection>

        <ContractSection number="2" title="Scope of work">
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>{data.inspectionParagraph}</Typography>
        </ContractSection>

        <ContractSection number="3" title="Payment">
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, mb: 0.75 }}>Payments are due as follows:</Typography>
          <Box sx={{ pl: 1.5 }}>
            {data.paymentLines.map((line) => (
              <Typography key={line} sx={{ fontSize: 13.5, lineHeight: 1.5, fontWeight: 600 }}>
                {line}
              </Typography>
            ))}
          </Box>
          {data.paymentNotes.map((line) => (
            <Typography key={line} sx={{ fontSize: 13.5, lineHeight: 1.5, mt: 0.65 }}>
              {line}
            </Typography>
          ))}
        </ContractSection>

        <ContractSection number="4" title="Notice to owner">
          <Box sx={{ border: '1.5px solid #000', px: 1.5, py: 1 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700, mb: 0.45, letterSpacing: '0.02em' }}>
              SECTION 7019 — CONTRACTORS LICENSE LAW
            </Typography>
            <Typography sx={{ fontSize: 10, lineHeight: 1.4 }}>{NOTICE_TEXT}</Typography>
          </Box>
        </ContractSection>

        <ContractSection number="5" title="License">
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.5 }}>
            Contractors are required by law to be licensed and regulated by the Contractors’ State License
            Board. Any questions concerning a contractor may be referred to the registrar of the board whose
            address is:
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', mt: 1.25, columnGap: 3 }}>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Contractors’ State License Board</Typography>
              <Typography sx={{ fontSize: 13, mt: 0.25 }}>{CSLB_ADDRESS}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>State Contractors’ License</Typography>
              <Typography sx={{ fontSize: 13, mt: 0.25 }}>{LICENSE_NUMBER}</Typography>
            </Box>
          </Box>
        </ContractSection>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 5, mt: 7, pt: 2.5 }}>
          <Typography sx={{ fontSize: 14, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
            Sign here
            <Box component="span" sx={{ flex: 1, borderBottom: '1px solid #000', height: 16 }} />
          </Typography>
          <Typography sx={{ fontSize: 14, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
            Date
            <Box component="span" sx={{ flex: 1, borderBottom: '1px solid #000', height: 16 }} />
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
