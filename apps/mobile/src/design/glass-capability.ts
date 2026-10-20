/** Both the OS API and the app's linked design must support Liquid Glass. */
export const supportsLiquidGlass = (
  apiAvailable: boolean,
  designAvailable: boolean
): boolean => apiAvailable && designAvailable;

/** Keep prominent labels on a filled control on every supported iOS version. */
export const actionButtonStyle = (glass: boolean, prominent: boolean) => {
  if (glass) {
    return prominent ? "glassProminent" : "glass";
  }
  return prominent ? "borderedProminent" : "bordered";
};
