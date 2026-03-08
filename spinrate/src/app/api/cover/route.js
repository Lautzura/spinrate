export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mbid = searchParams.get("mbid");
  const artist = searchParams.get("artist") || "";
  const title = searchParams.get("title") || "";
  const trackTitle = searchParams.get("track") || "";
  const mode = searchParams.get("mode") || "album"; // "album" | "track"

  let coverUrl = null;
  let previewUrl = null;
  let trackPreviews = {}; // { trackTitle: previewUrl }

  // 1. Cover Art Archive (only for albums)
  if (mbid && mode === "album") {
    try {
      const res = await fetch(`https://coverartarchive.org/release-group/${mbid}`, {
        headers: { "User-Agent": "Spinrate/1.0 (spinrate.app)" },
      });
      if (res.ok) {
        const data = await res.json();
        const img = data?.images?.find(i => i.front) || data?.images?.[0];
        coverUrl = img?.thumbnails?.["250"] || img?.thumbnails?.small || img?.image || null;
      }
    } catch {}
  }

  // 2. iTunes — cover fallback + previews
  try {
    const q = trackTitle
      ? encodeURIComponent(`${artist} ${trackTitle}`.trim())
      : encodeURIComponent(`${artist} ${title}`.trim());

    const entity = mode === "track" ? "song" : "album";
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&entity=${entity}&limit=5`);

    if (res.ok) {
      const data = await res.json();

      if (mode === "album") {
        // Get album cover + preview of first track
        const albumMatch = data.results?.find(r =>
          r.collectionName?.toLowerCase().includes(title.toLowerCase()) ||
          r.artistName?.toLowerCase().includes(artist.toLowerCase())
        ) || data.results?.[0];

        if (albumMatch) {
          if (!coverUrl && albumMatch.artworkUrl100) {
            coverUrl = albumMatch.artworkUrl100.replace("100x100bb", "250x250bb");
          }
          if (albumMatch.previewUrl) previewUrl = albumMatch.previewUrl;
        }

        // Also fetch all tracks for this album to get track previews
        if (albumMatch?.collectionId) {
          try {
            const tracksRes = await fetch(`https://itunes.apple.com/lookup?id=${albumMatch.collectionId}&entity=song&limit=30`);
            if (tracksRes.ok) {
              const tracksData = await tracksRes.json();
              tracksData.results?.forEach(t => {
                if (t.wrapperType === "track" && t.trackName && t.previewUrl) {
                  trackPreviews[t.trackName.toLowerCase()] = t.previewUrl;
                  // Also store by track number
                  if (t.trackNumber) trackPreviews[`track_${t.trackNumber}`] = t.previewUrl;
                }
              });
            }
          } catch {}
        }

      } else {
        // Single track preview
        const trackMatch = data.results?.find(r =>
          r.trackName?.toLowerCase().includes(trackTitle.toLowerCase())
        ) || data.results?.[0];
        if (trackMatch?.previewUrl) previewUrl = trackMatch.previewUrl;
      }
    }
  } catch {}

  return Response.json({ url: coverUrl, previewUrl, trackPreviews });
}
