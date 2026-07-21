export interface PackageRuntimeContributions {
  runtimePatches?: {
    writeIntentTurtleDebugFile?: boolean;
  };
}

export async function applyOnPackageLoad(args: {
  cloneDir: string;
  packageDir: string;
}): Promise<PackageRuntimeContributions> {
  void args;
  return {
    runtimePatches: {
      writeIntentTurtleDebugFile: true
    }
  };
}
