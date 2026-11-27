import { useState, type MouseEvent } from 'react';
import { Button, CircularProgress } from '@mui/material';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { extractWorksheet, renderWorksheet } from '../../utils/worksheetRead';
import { savedWorksheetNote, upsertWorksheetNote, worksheetJobNote } from '../../utils/worksheetNote';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type FileLike = {
  _id: string;
  originalName?: string;
  mimetype?: string;
};

type Props = {
  file: FileLike;
  jobId: string;
  onSaved: (job: unknown) => void;
};

/** Read a worksheet already stored on the job and save only the extra note. */
export default function WorksheetFileNoteButton({ file, jobId, onSaved }: Props) {
  const { user } = useAuth();
  const [reading, setReading] = useState(false);

  const saveNote = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (reading || !file?._id || !jobId) return;

    const toastId = toast.loading('Reading the worksheet…');
    setReading(true);
    try {
      const downloaded = await axios.get(`${API_URL}/files/${file._id}`, {
        responseType: 'blob',
        timeout: 60000,
      });
      const blob = downloaded.data as Blob;
      const filename = file.originalName || 'worksheet.pdf';
      const worksheetFile = new File([blob], filename, {
        type: file.mimetype || blob.type || 'application/pdf',
      });
      const canvas = await renderWorksheet(worksheetFile);
      const { reading: result } = await extractWorksheet(canvas, filename);
      const note = worksheetJobNote(result?.review, result?.draft?.gateCode);
      if (!note) {
        toast.error('That worksheet had no extra details to save', { id: toastId });
        return;
      }

      const current = await axios.get(`${API_URL}/jobs/${jobId}`);
      const hadNote = Boolean(savedWorksheetNote(current.data?.notes));
      const notes = upsertWorksheetNote(current.data?.notes, note);
      const response = await axios.patch(`${API_URL}/jobs/${jobId}`, {
        notes,
        createdBy: user?._id,
        createdByName: user?.name,
      });
      onSaved(response.data);
      toast.success(hadNote ? 'Updated the worksheet note' : 'Saved the worksheet note', { id: toastId });
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error || 'Could not read that worksheet'
        : 'Could not read that worksheet';
      toast.error(String(message), { id: toastId });
    } finally {
      setReading(false);
    }
  };

  return (
    <Button
      size="small"
      variant="contained"
      onClick={saveNote}
      disabled={reading}
      aria-label="Save worksheet note"
      sx={{
        position: 'absolute',
        left: 6,
        right: 6,
        bottom: 34,
        zIndex: 2,
        textTransform: 'none',
        fontSize: 12,
        py: 0.25,
        minWidth: 0,
      }}
    >
      {reading ? (
        <>
          <CircularProgress size={12} sx={{ mr: 0.75, color: 'inherit' }} />
          Reading…
        </>
      ) : (
        'Save note'
      )}
    </Button>
  );
}
