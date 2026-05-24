export interface PackageRuntimeContributions {
  runtimePatches?: {
    cliNoGraphDbFlag?: boolean;
  };
}

export async function applyOnPackageLoad(args: {
  cloneDir: string;
  packageDir: string;
}): Promise<PackageRuntimeContributions> {
  void args;
  return {
    runtimePatches: {
      cliNoGraphDbFlag: true
    }
  };
}
