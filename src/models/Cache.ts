import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
  PrimaryColumn,
} from "typeorm";
import { NeedUploadFolder } from "../types";
  
/** Class representing a cached entity. */
@Entity({ name: "caches" })
export class Cache {
    @PrimaryGeneratedColumn()
      id: number;

    @PrimaryColumn()
      hpc: string;
  
    @Column("json")
      folder: NeedUploadFolder;
  
    @Column({
      type: "bigint",
      transformer: {
        to: (
          i: Date | null | undefined
        ): number | null => (i ? i.getTime() : null),
        from: (
          i: number | null | undefined
        ): Date | null => (i ? new Date(Math.trunc(i)) : null),
      },
    })
      createdAt: Date;
  
    @Column({
      type: "bigint",
      nullable: true,
      transformer: {
        to: (
          i: Date | null | undefined
        ): number | null => (i ? i.getTime() : null),
        from: (
          i: number | null | undefined
        ): Date | null => (i ? new Date(Math.trunc(i)) : null),
      },
    })
      updatedAt: Date;
  
    /**
     * Set the createdAt time to the current time.
     *
     * @return {Date} date - Date this job was created.
     */
    @BeforeInsert()
    setCreatedUpdated() {
      this.createdAt = new Date();
      this.updatedAt = new Date();
    }
}
  