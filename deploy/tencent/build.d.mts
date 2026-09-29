export function validateRelease(value: string): string;
export function releaseFiles(files: string[]): string[];
export function build(release: string, offline?: boolean): Promise<string>;
