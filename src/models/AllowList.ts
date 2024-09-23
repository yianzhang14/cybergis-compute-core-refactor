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

  @Column({ type: "date" })
    createdAt!: Date;

  @Column({ type: "date" })
    updatedAt!: Date;

  @Column({ type: "date" })
    deletedAt!: Date;

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

  update() {
    this.createdAt = new Date();
  }

  delete() {
    this.deletedAt = new Date();
  }
}
    