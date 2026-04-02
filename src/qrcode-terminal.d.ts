declare module "qrcode-terminal" {
  const qr: {
    generate(text: string, options?: { small?: boolean }, callback?: (code: string) => void): void;
  };
  export default qr;
}
