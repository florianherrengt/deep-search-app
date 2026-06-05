type GoogleMapsMode = "driving" | "cycling" | "walking" | "transit" | "flights";

interface GoogleMapsRouteParams {
  from: string;
  dest: string;
  leavingTime: string | Date;
  mode?: GoogleMapsMode;
}

export function createGoogleMapsRouteUrl({
  from,
  dest,
  leavingTime,
  mode = "driving",
}: GoogleMapsRouteParams): string {
  const modes: Record<GoogleMapsMode, string> = {
    driving: "0",
    cycling: "1",
    walking: "2",
    transit: "3",
    flights: "4",
  };

  const fromEncoded = encodeURIComponent(from).replace(/%20/g, "+");
  const destEncoded = encodeURIComponent(dest).replace(/%20/g, "+");

  const date = new Date(leavingTime);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid leavingTime: ${String(leavingTime)}`);
  }

  const timestamp = Math.floor(date.getTime() / 1000);

  return `https://www.google.com/maps/dir/${fromEncoded}/${destEncoded}/data=!2m3!6e0!7e2!8j${timestamp}!3e${modes[mode]}`;
}
