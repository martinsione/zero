import {nanoid} from 'nanoid';

export type Track = {
  id: string;
  title: string;
  length: number;
  albumId: string;
};

export type Album = {
  id: string;
  title: string;
  artistId: string;
};

export type Artist = {
  id: string;
  name: string;
};

export type Playlist = {
  id: string;
  name: string;
};

export type TrackArtist = {
  id: `${TrackArtist['trackId']}-${TrackArtist['artistId']}`;
  trackId: string;
  artistId: string;
};

export type PlaylistTrack = {
  id: `${PlaylistTrack['playlistId']}-${PlaylistTrack['trackId']}`;
  playlistId: string;
  trackId: string;
  position: number;
};

export function createRandomArtists(
  n: number,
  autoIncr: boolean = false,
): Artist[] {
  let id = 0;
  return Array.from({length: n}, () => ({
    id: autoIncr ? `${++id}` : nanoid(),
    name: autoIncr ? `Artist ${id}` : nanoid(),
  }));
}

export function createRandomAlbums(
  n: number,
  artists: Artist[],
  autoIncr: boolean = false,
): Album[] {
  let id = 0;
  return Array.from({length: n}, () => ({
    id: autoIncr ? `${++id}` : nanoid(),
    title: autoIncr ? `Album ${id}` : nanoid(),
    artistId: autoIncr
      ? artists[0].id
      : artists[Math.floor(Math.random() * artists.length)].id,
  }));
}

export function createRandomTracks(
  n: number,
  albums: Album[],
  autoIncr: boolean = false,
): Track[] {
  let id = 0;
  return Array.from({length: n}, () => ({
    id: autoIncr ? `${++id}` : nanoid(),
    title: autoIncr ? `Track ${id}` : nanoid(),
    length: autoIncr ? id * 1000 : Math.floor(Math.random() * 300000) + 1000,
    albumId: autoIncr
      ? albums[0].id
      : albums[Math.floor(Math.random() * albums.length)].id,
  }));
}

export function linkTracksToArtists(
  artists: Artist[],
  tracks: Track[],
  assignAll: boolean = false,
): TrackArtist[] {
  // assign each track to 1-3 artists
  return tracks.flatMap(t => {
    const numArtists = assignAll
      ? artists.length
      : Math.floor(Math.random() * 3) + 1;
    const artistsForTrack = new Set<string>();
    while (artistsForTrack.size < numArtists) {
      artistsForTrack.add(
        artists[Math.floor(Math.random() * artists.length)].id,
      );
    }
    return [...artistsForTrack].map(a => ({
      id: `${t.id}-${a}`,
      trackId: t.id,
      artistId: a,
    }));
  });
}