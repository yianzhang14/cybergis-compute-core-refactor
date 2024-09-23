import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
  PrimaryColumn,
} from "typeorm";
    
/** Class representing an user approved to a particular HPC. */
@Entity({ name: "allowlist" })
export class AllowList {
  @PrimaryGeneratedColumn()
    id!: number;

  @PrimaryColumn()
    user!: string;

  @PrimaryColumn()
    hpc!: string;

  @Column({ type: "datetime", default: () => "CURRENT_TIMESTAMP" })
    createdAt!: Date;

  @Column({ type: "datetime", nullable: true })
    deletedAt?: Date;

  /**
   * Set the createdAt time to the current time.
   *
   * @return {Date} date - Date this job was created.
   */
  @BeforeInsert()
  setCreatedUpdated() {
    this.createdAt = new Date();
  }

  delete() {
    this.deletedAt = new Date();
  }
}
    