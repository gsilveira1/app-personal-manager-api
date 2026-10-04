import { Module } from "@nestjs/common";

import { CLIENT_DIRECTORY } from "../../common/ports";
import { ClientDirectoryService } from "./client-directory.service";

/**
 * Read-only client lookups for the other modules. Provides and exports CLIENT_DIRECTORY
 * and depends on the global PrismaService only (no domain module imports), so every
 * module can import it without cycles. Contract: docs/api-contract-v2.md, section 4.
 */
@Module({
  providers: [
    ClientDirectoryService,
    { provide: CLIENT_DIRECTORY, useExisting: ClientDirectoryService },
  ],
  exports: [CLIENT_DIRECTORY],
})
export class ClientDirectoryModule {}
