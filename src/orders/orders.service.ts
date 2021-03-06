import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PubSub } from 'graphql-subscriptions';
import {
  ANOTHER_DRIVER_TAKE_ORDER,
  NEW_COOKED_ORDER,
  NEW_PENDING_ORDER,
  NEW_UPDATE_ORDER,
  PICKUP_ORDER,
  PUB_SUB,
} from 'src/common/common.constants';
import { Dish } from 'src/restaurants/entities/dish.entity';
import { Restaurant } from 'src/restaurants/entities/restaurant.entity';
import { User, UserRole } from 'src/users/entities/user.entity';
import { Between, Repository } from 'typeorm';
import { CreateOrderInput, CreateOrderOutput } from './dtos/create-order.dto';
import { EditOrderInput, EditOrderOutput } from './dtos/edit-order.dto';
import {
  GetDriverOrdersInput,
  GetDriverOrdersOutput,
} from './dtos/get-driver-orders.dto';
import { GetOrderInput, GetOrderOutput } from './dtos/get-order.dto';
import { GetOrdersInput, GetOrdersOutput } from './dtos/get-orders.dto';
import { TakeOrderInput, TakeOrderOutput } from './dtos/take-order.dto';
import { OrderItem } from './entites/order-item.entity';
import { Order, OrderStatus } from './entites/order.entity';
import { CommonService } from 'src/common/common.service';
import { GetOwnerOrdersInput } from './dtos/get-owner-orders.dto';
import { GetDriverOrderInput } from './dtos/get-driver-order.dto';
import { getDistance } from 'src/util';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    @InjectRepository(Dish)
    private readonly dishes: Repository<Dish>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @Inject(PUB_SUB) private readonly pubsub: PubSub,
    private readonly commonService: CommonService,
  ) {}

  async createOrder(
    customer: User,
    createOrderInput: CreateOrderInput,
  ): Promise<CreateOrderOutput> {
    try {
      const { restaurantId, items } = createOrderInput;
      const restaurant = await this.restaurants.findOne(restaurantId);
      if (!restaurant) throw new Error('Not Found Restaurant');

      const { orderItems, total } = await Promise.resolve(
        items.reduce(async (prev, curr) => {
          const dish = await this.dishes.findOne(curr.dishId);
          let dishFinalPrice = dish.price;

          curr.options?.forEach(option => {
            const dishOption = dish.options?.find(
              dishOption => dishOption.name === option.name,
            );
            if (!dishOption) return;
            if (dishOption.price) {
              dishFinalPrice += dishOption.price;
              return;
            }
            if (!dishOption.choices) return;

            const choiceOption = dishOption.choices.find(
              choice => choice.name === option.choice,
            );
            if (!choiceOption) return;
            if (!choiceOption.price) return;
            dishFinalPrice += choiceOption.price;
          });

          const orderItem = await this.orderItems.save(
            this.orderItems.create({
              dish,
              options: curr.options,
              total: dishFinalPrice,
            }),
          );
          (await prev).orderItems.push(orderItem);
          (await prev).total += dishFinalPrice;

          return Promise.resolve(prev);
        }, Promise.resolve({ orderItems: [], total: 0 })),
      );

      const newOrder = await this.orders.save(
        this.orders.create({
          customer,
          restaurant,
          items: orderItems,
          total,
        }),
      );
      await this.pubsub.publish(NEW_PENDING_ORDER, {
        pendingOrders: { order: newOrder, ownerId: restaurant.ownerId },
      });
      return { ok: true, orderId: newOrder.id };
    } catch (e) {
      return { ok: false, error: 'Cound not create order' };
    }
  }

  async getOrders(
    user: User,
    { status }: GetOrdersInput,
  ): Promise<GetOrdersOutput> {
    try {
      let orders: Order[];
      if (user.role === UserRole.Client) {
        orders = await this.orders.find({
          where: {
            customer: user,
            ...(status && { status }),
          },
        });
      }
      if (user.role === UserRole.Delivery) {
        orders = await this.orders.find({
          where: {
            driver: user,
            ...(status && { status }),
          },
        });
      }
      if (user.role === UserRole.Owner) {
        const restaurants = await this.restaurants.find({
          where: { owner: user },
          relations: ['orders'],
        });

        orders = restaurants.reduce(
          (prev, curr) =>
            prev.concat(curr.orders.filter(order => order.status === status)),
          [],
        );
      }
      return { ok: true, orders };
    } catch (e) {
      return {
        ok: false,
        error: e.message ? e.message : 'Could not get orders',
      };
    }
  }

  checkOrderRole(user: User, order: Order): void {
    if (
      (user.role === UserRole.Client && user.id !== order.customerId) ||
      (user.role === UserRole.Delivery && user.id !== order.driverId) ||
      (user.role === UserRole.Owner && user.id !== order.restaurant.ownerId)
    ) {
      throw new Error("You Can't see that");
    }
  }

  async getOrder(
    user: User,
    { id: orderId }: GetOrderInput,
  ): Promise<GetOrderOutput> {
    try {
      const order = await this.orders.findOne(orderId, {
        relations: ['restaurant', 'restaurant.owner', 'items'],
      });
      this.checkOrderRole(user, order);

      return { ok: true, order };
    } catch (e) {
      return {
        ok: false,
        error: e.message ? e.message : 'Could not get order',
      };
    }
  }

  async getOwnerOrders({ restaurantId, statuses }: GetOwnerOrdersInput) {
    try {
      const orders = await this.orders
        .createQueryBuilder('order')
        .innerJoinAndSelect('order.restaurant', 'restaurant')
        .innerJoinAndSelect('order.items', 'items')
        .innerJoinAndSelect('items.dish', 'dish')
        .where('order.restaurantId = :restaurantId', { restaurantId })
        .andWhere('order.status IN (:...statuses)', { statuses })
        .getMany();

      return { ok: true, orders };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  checkEditOrderRole(userRole: UserRole, status: OrderStatus): void {
    if (userRole === UserRole.Client)
      throw new Error("Can't edit order that role is client");
    if (
      userRole === UserRole.Owner &&
      !(status === OrderStatus.Cooking || status === OrderStatus.Cooked)
    ) {
      throw new Error("Can't edit order wrong role");
    }
    if (
      userRole === UserRole.Delivery &&
      !(status === OrderStatus.PickUp || status === OrderStatus.Drivered)
    ) {
      throw new Error("Can't edit order wrong role");
    }
  }

  async editOrder(
    user: User,
    { status, id: orderId }: EditOrderInput,
  ): Promise<EditOrderOutput> {
    try {
      const order = await this.orders.findOne(orderId);

      this.checkOrderRole(user, order);
      this.checkEditOrderRole(user.role, status);

      await this.orders.save([{ id: orderId, status }]);

      const newOrder = { ...order, status };

      if (user.role === UserRole.Owner && status === OrderStatus.Cooking) {
        await this.pubsub.publish(NEW_COOKED_ORDER, {
          cookedOrder: newOrder,
        });
      }

      if (user.role === UserRole.Delivery && status === OrderStatus.PickUp) {
        await this.pubsub.publish(PICKUP_ORDER, {
          order: newOrder,
        });
      }

      await this.pubsub.publish(NEW_UPDATE_ORDER, {
        orderUpdates: newOrder,
      });

      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e.message ? e.message : 'Could not edit order',
      };
    }
  }

  async takeOrder(
    driver: User,
    { id: orderId }: TakeOrderInput,
  ): Promise<TakeOrderOutput> {
    try {
      const order = await this.orders.findOne(orderId);
      if (!order) throw new Error('Not Found Order');
      if (order.driverId) throw new Error('Already Exist Driver');
      await this.orders.save([
        {
          id: orderId,
          driver,
        },
      ]);
      await this.pubsub.publish(NEW_UPDATE_ORDER, {
        orderUpdates: { ...order, driver, driverId: driver.id },
      });
      await this.pubsub.publish(ANOTHER_DRIVER_TAKE_ORDER, {
        order,
      });
      return { ok: true, order: { ...order, driver, driverId: driver.id } };
    } catch (e) {
      return {
        ok: false,
        error: e.message ? e.message : 'Could not take order',
      };
    }
  }

  async getDriverOrders(
    getDriverOrdersInput: GetDriverOrdersInput,
  ): Promise<GetDriverOrdersOutput> {
    try {
      const { status, lat, lng } = getDriverOrdersInput;

      const driverPosition = {
        type: 'Point',
        coordinates: [lat, lng],
      };

      // 거리가 3km 이하 음식점의 주문만 받는다.
      const orders = await this.orders
        .createQueryBuilder('order')
        .innerJoinAndSelect('order.customer', 'customer')
        .innerJoinAndSelect('order.restaurant', 'restaurant')
        .innerJoinAndSelect('order.items', 'items')
        .innerJoinAndSelect('items.dish', 'dish')
        .where(
          'ST_DistanceSphere(restaurant.position, ST_GeomFromGeoJSON(:position)) < 3000',
        )
        .andWhere(
          status ? 'order.status = :status' : 'order.status IN (:...status)',
          {
            status: status ? status : [OrderStatus.Cooking, OrderStatus.Cooked],
          },
        )
        .orderBy('order.id', 'DESC')
        .setParameters({ position: JSON.stringify(driverPosition) })
        .getMany();

      const result = orders.map(order => {
        const distance = getDistance({ lat, lng }, order.restaurant.position);
        return { ...order, distance };
      });

      return { ok: true, orders: result.filter(order => !order.driverId) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async getDriverOrder({ id, lat, lng }: GetDriverOrderInput) {
    try {
      const order = await this.orders.findOne(id, {
        relations: ['restaurant', 'customer'],
      });
      let distance;

      if (lat && lat) {
        distance = getDistance({ lat, lng }, order.restaurant.position);
      }

      return { ok: true, order: { ...order, distance } };
    } catch {
      return { ok: false };
    }
  }

  async getDriverOwnOrders(user: User) {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);

      const orders = await this.orders.find({
        where: {
          driver: user,
          updatedAt: Between(start, end),
        },
      });

      return { ok: true, orders };
    } catch {
      return { ok: false };
    }
  }
}
