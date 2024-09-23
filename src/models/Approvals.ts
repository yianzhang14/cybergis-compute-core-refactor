import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
} from "typeorm";
    
/** Class representing a pending allow/deny approval. */
@Entity({ name: "approvals" })
export class Approvals {
  @PrimaryGeneratedColumn()
    id!: number;

  @Column()
    user!: string;

  @Column()
    hpc!: string;

  @Column()
    type!: string;

  @Column()
    hash!: string;

  @Column({ type: "date" })
    createdAt!: Date;

  @Column({ type: "date" })
    updatedAt!: Date;

  @Column({ 
    type: "date",
    nullable: true
  })
    approvedAt?: Date;

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

  approve() {
    this.approvedAt = new Date();
  }
}
    