import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
  PrimaryColumn,
} from "typeorm";
    
/** Class representing a cached entity. */
@Entity({ name: "allowlist" })
export class AllowList {
  @PrimaryGeneratedColumn()
    id!: number;

  @PrimaryColumn()
    user!: string;

    @Column({ type: "date" })
      createdAt!: Date;

  @Column({ type: "date" })
    updatedAt!: Date;

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
}
    