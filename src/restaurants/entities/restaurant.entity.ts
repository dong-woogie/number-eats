import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { IsString } from 'class-validator';
import { Column, Entity, ManyToOne, OneToMany, RelationId } from 'typeorm';
import { CoreEntity } from 'src/common/entities/core.entity';
import { Category } from './category.entity';
import { User } from 'src/users/entities/user.entity';
import { Dish } from './dish.entity';
import { Order } from 'src/orders/entites/order.entity';
import { PositionEntity } from 'src/common/entities/position.entity';

@InputType('RestaurantInputType', { isAbstract: true })
@ObjectType()
@Entity()
export class Restaurant extends CoreEntity {
  @Field(type => String)
  @Column()
  @IsString()
  name: string;

  @Field(type => String)
  @Column({ default: '강남' })
  @IsString()
  address: string;

  @Field(type => PositionEntity, { nullable: true })
  @Column('geometry', {
    nullable: true,
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  position: object;

  @Field(type => String, { nullable: true })
  @Column({ nullable: true })
  @IsString()
  coverImg: string;

  @Field(type => Category, { nullable: true })
  @ManyToOne(type => Category, category => category.restaurants, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  category?: Category;

  @Field(type => User)
  @ManyToOne(type => User, user => user.restaurants, {
    onDelete: 'CASCADE',
  })
  owner: User;

  @RelationId((restaurant: Restaurant) => restaurant.owner)
  ownerId: number;

  @Field(type => [Dish])
  @OneToMany(type => Dish, dish => dish.restaurant)
  menu: Dish[];

  @Field(type => [Order])
  @OneToMany(type => Order, order => order.restaurant)
  orders: Order[];

  @Field(type => Boolean)
  @Column({ default: false })
  isPromoted: boolean;

  @Field(type => Date)
  @Column({ type: 'date', nullable: true })
  promotedUntil: Date;
}
