import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
} from "typeorm";
    
/** Class representing a cached entity. */
@Entity({ name: "approvals" })
export class Approvals {
  @PrimaryGeneratedColumn()
    id!: number;

  @Column({ type: "string" })
    user!: string;

  @Column({ type: "date" })
    createdAt!: Date;

  @Column({ type: "date" })
    updatedAt!: Date;

  @Column({ 
    type: "date",
    nullable: true
  })
    approvedAt?: Date;

  @Column({
    type: "string",
    nullable: true
  })
    approvedBy?: string;

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
    