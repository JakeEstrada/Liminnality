import { jsPDF } from 'jspdf';

const OWNER_NAME = 'Edward T. Estrada';
const OWNER_PHONE = '949-498-4397';
const LICENSE_NUMBER = '# C-6 753246';
const CSLB_ADDRESS = '9835 Goethe Road';
const STAINER_REFERRALS = '*Jesus (949)616-2038 | *Carlos Jimenez (714)678-7072';
const SHOP_ADDRESS_1 = '1030 Calle Sombra, F';
const SHOP_ADDRESS_2 = 'San Clemente, CA 92673';
const COVER_LOGO = '/scww.png';
const ZELLE_QR = '/contract-zelle-qr.png?v=3';

const NOTICE_TEXT =
  'Under the Mechanics’ Lien law, any contractor, subcontractor, laborer, material man or other person who helps to improve your property and is not paid for his labor, services or materials has a right to enforce his claim against your property. Under the law you may protect yourself against such claims by filing, before commencing such work of improvement, an original contract for the work of improvement or a modification thereof, in the office of the county recorder of the county where the property is situated and requiring that a contractor’s payment bond be recorded in such office. Said bond shall be in an amount not less than fifty percent (50%) of the contract price and shall, in addition to any conditions for the performance of the contract, be conditioned for the payment in full of the claims of all persons furnishing labor, services, equipment or materials for the work described in said contract. Owner has a 3 day right of rescission to cancel contract after date of signing.';

export type ContractCoverPdfInput = {
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

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function imageToPng(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return '';
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function buildContractCoverPdf(input: ContractCoverPdfInput) {
  const [logoImg, qrImg] = await Promise.all([loadImage(COVER_LOGO), loadImage(ZELLE_QR)]);
  const logo = logoImg ? imageToPng(logoImg) : '';
  const qr = qrImg ? imageToPng(qrImg) : '';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = 612;
  const H = 792;
  const margin = 28;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(3.2);
  doc.rect(margin, margin, W - margin * 2, H - margin * 2);

  let y = margin + 52;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(0, 0, 0);
  doc.text('Contract. Packet', W / 2, y, { align: 'center' });

  y += 38;
  doc.setFontSize(13);
  doc.text('CUSTOMER', W / 2, y, { align: 'center' });

  y += 24;
  doc.setFontSize(18);
  doc.text(String(input.customerName || '').trim() || ' ', W / 2, y, { align: 'center' });

  if (input.street) {
    y += 20;
    doc.setFontSize(15);
    doc.text(input.street, W / 2, y, { align: 'center' });
  }
  if (input.cityStateDisplay) {
    y += 18;
    doc.setFontSize(15);
    doc.text(input.cityStateDisplay, W / 2, y, { align: 'center' });
  }

  if (logo) {
    const logoW = 118;
    const logoH = 118;
    doc.addImage(logo, 'PNG', (W - logoW) / 2, 250, logoW, logoH);
  }

  const boxW = 250;
  const boxX = (W - boxW) / 2;
  const boxY = 384;
  doc.setLineWidth(1.2);
  doc.rect(boxX, boxY, boxW, 58);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('San Clemente Woodworking', W / 2, boxY + 20, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(SHOP_ADDRESS_1, W / 2, boxY + 36, { align: 'center' });
  doc.text(SHOP_ADDRESS_2, W / 2, boxY + 50, { align: 'center' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  const thanks = doc.splitTextToSize(
    'We appreciate the opportunity to work with you and look forward to completing your project.',
    360,
  );
  doc.text(thanks, W / 2, 468, { align: 'center' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10.5);
  doc.text('Stainer Referrals:', W / 2, 516, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(STAINER_REFERRALS, W / 2, 532, { align: 'center' });

  if (qr) {
    const qrW = 168;
    doc.addImage(qr, 'PNG', (W - qrW) / 2, 548, qrW, qrW);
  }

  doc.addPage();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Contract', W / 2, 46, { align: 'center' });

  const left = 56;
  const maxW = W - left * 2;
  y = 72;

  const heading = (n: number, title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`${n}. ${title.toUpperCase()}`, left, y);
    y += 14;
  };

  const body = (text: string, size = 10.5, leading = 14) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxW);
    doc.text(lines, left, y);
    y += lines.length * leading + 10;
  };

  heading(1, 'Agreement');
  body(
    `This agreement is made and entered into on ${input.contractDate}, by and between owner or manager ${OWNER_NAME}, phone ${OWNER_PHONE}. San Clemente Woodworking proposes to complete the following as per attached Estimate #${input.estimateNumber || '______'} with owner’s signature, for a total of ${input.totalLabel}.`,
  );

  heading(2, 'Scope of work');
  body(input.inspectionParagraph);

  heading(3, 'Payment');
  body('Payments are due as follows:');
  y -= 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  for (const line of input.paymentLines) {
    const wrapped = doc.splitTextToSize(line, maxW - 10);
    doc.text(wrapped, left + 10, y);
    y += wrapped.length * 14;
  }
  y += 8;
  doc.setFont('helvetica', 'normal');
  for (const line of input.paymentNotes) {
    const wrapped = doc.splitTextToSize(line, maxW);
    doc.text(wrapped, left, y);
    y += wrapped.length * 14 + 2;
  }
  y += 10;

  heading(4, 'Notice to owner');
  const noticeLines = doc.splitTextToSize(NOTICE_TEXT, maxW - 16);
  const noticeH = 16 + noticeLines.length * 11 + 10;
  doc.setLineWidth(1.2);
  doc.rect(left, y, maxW, noticeH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('SECTION 7019 — CONTRACTORS LICENSE LAW', left + 8, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(noticeLines, left + 8, y + 28);
  y += noticeH + 16;

  heading(5, 'License');
  body(
    'Contractors are required by law to be licensed and regulated by the Contractors’ State License Board. Any questions concerning a contractor may be referred to the registrar of the board whose address is:',
    10.5,
    14,
  );
  y -= 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Contractors’ State License Board', left, y);
  doc.text('State Contractors’ License', left + maxW / 2, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.text(CSLB_ADDRESS, left, y);
  doc.text(LICENSE_NUMBER, left + maxW / 2, y);

  y = Math.max(y + 56, 700);
  doc.setFontSize(11);
  doc.text('Sign here', left, y);
  doc.line(left + 58, y + 1, left + maxW / 2 - 16, y + 1);
  doc.text('Date', left + maxW / 2 + 8, y);
  doc.line(left + maxW / 2 + 38, y + 1, left + maxW, y + 1);

  return doc;
}
