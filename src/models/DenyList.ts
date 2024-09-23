import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
  PrimaryColumn,
} from "typeorm";
  
/** Class representing a user denied from a particular HPC. */
@Entity({ name: "denylist" })
export class DenyList {
  
  @PrimaryGeneratedColumn()
    id!: number;

  @PrimaryColumn()
    user!: string;

  @PrimaryColumn()
    hpc!: string;

  @Column({ type: "date", default: () => "CURRENT_TIMESTAMP" })
    createdAt!: Date;

  @Column({ type: "date", nullable: true })
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
  