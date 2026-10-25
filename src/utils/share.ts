/**
 * Opens the native share sheet when available, otherwise copies the URL to the clipboard.
 * Returns what happened so callers can show the right feedback.
 */
export async function shareOrCopy(data: { title: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch {
      // User cancelled
      return 'failed';
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    return 'copied';
  } catch (err) {
    console.error('Failed to copy:', err);
    return 'failed';
  }
}
